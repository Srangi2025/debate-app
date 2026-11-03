import { Pool, type PoolClient } from "pg";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import type { ArchivedMatch, HistoryCursor } from "./history-store.ts";

const hash = (credential: string) => createHash("sha256").update(credential).digest("hex");
type Row = { id: string; created_at: string; ended_at: string; snapshot: ArchivedMatch };

export class PostgresHistoryStore {
  readonly pool: Pool;
  constructor(url: string) {
    let parsed: URL;
    try { parsed = new URL(url); }
    catch { throw new Error("Invalid history database URL"); }
    if (!["postgres:", "postgresql:"].includes(parsed.protocol)) throw new Error("Invalid history database URL protocol");
    const local = ["localhost", "127.0.0.1", "[::1]"].includes(parsed.hostname);
    if (!local && ["disable", "no-verify", "allow", "prefer"].includes(parsed.searchParams.get("sslmode") || "")) {
      throw new Error("Remote history storage requires verified TLS");
    }
    // pg's sslmode=require can accept weaker verification; always verify remote hosts.
    if (!local) parsed.searchParams.set("sslmode", "verify-full");
    let ssl;
    const ca = !local ? process.env.HISTORY_DATABASE_CA || (process.env.HISTORY_DATABASE_CA_FILE
      ? readFileSync(process.env.HISTORY_DATABASE_CA_FILE, "utf8") : undefined) : undefined;
    if (ca) {
      parsed.searchParams.delete("sslmode");
      // Avoid URL SSL options overriding the explicitly configured trusted root.
      for (const option of ["ssl", "sslrootcert", "sslcert", "sslkey", "uselibpqcompat"]) parsed.searchParams.delete(option);
      ssl = { rejectUnauthorized: true, ca: ca.replace(/\\n/g, "\n") };
    }
    this.pool = new Pool({ connectionString: parsed.href, ssl, max: process.env.VERCEL ? 1 : 3, idleTimeoutMillis: 10000,
      connectionTimeoutMillis: 10000, statement_timeout: 15000, query_timeout: 20000,
      application_name: "ranked-debate" });
    this.pool.on("error", () => console.error("[history] PostgreSQL connection interrupted"));
  }

  // Serialize ownership-changing writes with archival/session writes. This prevents
  // a concurrent claim from leaving a late archive or credential with the old owner.
  private async transaction<T>(fn: (client: PoolClient) => Promise<T>): Promise<T> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("SELECT pg_advisory_xact_lock(736284109)");
      const result = await fn(client);
      await client.query("COMMIT");
      return result;
    } catch (error) { await client.query("ROLLBACK").catch(() => {}); throw error; }
    finally { client.release(); }
  }

  async participantOwner(id: string): Promise<string> {
    const { rows } = await this.pool.query("SELECT account_id FROM ranked_debate.guest_claims WHERE guest_id=$1", [id]);
    return rows[0]?.account_id ?? id;
  }

  async save(snapshot: ArchivedMatch): Promise<boolean> {
    const { match, result } = snapshot;
    if (match.status !== "ended" || result.status !== "finished" || result.matchId !== match.id ||
      !match.player1?.userId || !match.player2?.userId || match.player1.userId === match.player2.userId) throw new Error("Only completed two-participant results can be archived");
    return this.transaction(async client => {
      const saved = await client.query("INSERT INTO ranked_debate.history_matches(id,created_at,ended_at,snapshot) VALUES($1,$2,$3,$4) ON CONFLICT DO NOTHING RETURNING id",
        [match.id, match.createdAt, match.endedAt ?? Number(result.endedAt), JSON.stringify(snapshot)]);
      if (!saved.rowCount) return false;
      for (const [side, player] of [["A", match.player1], ["B", match.player2]] as const) {
        await client.query(`INSERT INTO ranked_debate.history_members(match_id,participant_id,owner_id,side)
          VALUES($1,$2,COALESCE((SELECT account_id FROM ranked_debate.guest_claims WHERE guest_id=$2),$2),$3)`, [match.id, player.userId, side]);
      }
      return true;
    });
  }

  async get(owner: string, id: string): Promise<ArchivedMatch | null> {
    const { rows } = await this.pool.query<Row>(`SELECT m.* FROM ranked_debate.history_matches m WHERE m.id=$1
      AND EXISTS(SELECT 1 FROM ranked_debate.history_members p WHERE p.match_id=m.id AND p.owner_id=$2)`, [id, owner]);
    return rows[0]?.snapshot ?? null;
  }

  async list(owner: string, cursor?: HistoryCursor, limit = 20) {
    const bounded = Math.max(1, Math.min(50, Math.floor(limit)));
    const { rows } = await this.pool.query<Row>(`SELECT m.* FROM ranked_debate.history_matches m
      WHERE EXISTS(SELECT 1 FROM ranked_debate.history_members p WHERE p.match_id=m.id AND p.owner_id=$1)
      AND ($2::bigint IS NULL OR (m.ended_at,m.id)<($2::bigint,$3::text)) ORDER BY m.ended_at DESC,m.id DESC LIMIT $4`,
    [owner, cursor?.endedAt ?? null, cursor?.id ?? "", bounded + 1]);
    const page = rows.slice(0, bounded), last = page.at(-1);
    return {
      matches: page.map(row => ({ id: row.id, createdAt: Number(row.created_at), endedAt: Number(row.ended_at),
        topics: row.snapshot.match.topics, player1: row.snapshot.match.player1, player2: row.snapshot.match.player2,
        winner: row.snapshot.result.winner, judgeVersion: row.snapshot.result.judgeVersion })),
      nextCursor: rows.length > bounded && last ? { endedAt: Number(last.ended_at), id: last.id } : null,
    };
  }

  async profile(id: string): Promise<string | null> {
    const { rows } = await this.pool.query("SELECT username FROM ranked_debate.profiles WHERE user_id=$1", [id]);
    return rows[0]?.username ?? null;
  }
  async saveProfile(id: string, name: string): Promise<void> {
    if (!name.trim() || name.length > 100) throw new Error("Invalid display name");
    await this.transaction(async client => {
      await client.query(`INSERT INTO ranked_debate.profiles VALUES($1,$2,$3)
        ON CONFLICT(user_id) DO UPDATE SET username=excluded.username,updated_at=excluded.updated_at`, [id, name, Date.now()]);
    });
  }

  async rememberGuest(credential: string, id: string, expiresAt: number): Promise<boolean> {
    return this.transaction(async client => {
      const { rows } = await client.query("SELECT account_id FROM ranked_debate.guest_claims WHERE guest_id=$1", [id]);
      if (rows.length) return false;
      await client.query("INSERT INTO ranked_debate.guest_sessions VALUES($1,$2,$3) ON CONFLICT DO NOTHING", [hash(credential), id, expiresAt]);
      return true;
    });
  }
  async guest(credential: string): Promise<string | null> {
    const { rows } = await this.pool.query(`SELECT s.guest_id FROM ranked_debate.guest_sessions s
      WHERE credential_hash=$1 AND expires_at>$2 AND NOT EXISTS(SELECT 1 FROM ranked_debate.guest_claims c WHERE c.guest_id=s.guest_id)`, [hash(credential), Date.now()]);
    return rows[0]?.guest_id ?? null;
  }

  async claimGuest(guest: string, account: string): Promise<{ imported: number; alreadyClaimed: boolean }> {
    if (!guest.startsWith("guest:") || account.startsWith("guest:") || !account) throw new Error("Invalid guest claim");
    return this.transaction(async client => {
      const owner = (await client.query("SELECT account_id FROM ranked_debate.guest_claims WHERE guest_id=$1", [guest])).rows[0]?.account_id;
      if (owner) {
        if (owner === account) return { imported: 0, alreadyClaimed: true };
        throw new Error("This guest history already belongs to another account");
      }
      const { rows } = await client.query("SELECT COUNT(DISTINCT match_id) AS count FROM ranked_debate.history_members WHERE owner_id=$1", [guest]);
      await client.query("INSERT INTO ranked_debate.guest_claims VALUES($1,$2,$3)", [guest, account, Date.now()]);
      await client.query("UPDATE ranked_debate.history_members SET owner_id=$1 WHERE owner_id=$2", [account, guest]);
      await client.query(`INSERT INTO ranked_debate.profiles SELECT $1,username,$3 FROM ranked_debate.profiles WHERE user_id=$2
        ON CONFLICT(user_id) DO NOTHING`, [account, guest, Date.now()]);
      await client.query("DELETE FROM ranked_debate.guest_sessions WHERE guest_id=$1", [guest]);
      return { imported: Number(rows[0].count), alreadyClaimed: false };
    });
  }

  async close() { await this.pool.end(); }
}
