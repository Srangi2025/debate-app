import { DatabaseSync } from "node:sqlite";
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, existsSync, chmodSync } from "node:fs";
import { dirname, resolve } from "node:path";
import type { TranscriptSegment } from "./transcript.ts";

export type ArchivedMatch = {
  match: {
    id: string; topics: string[]; status: string; createdAt: number; endedAt?: number;
    player1: { userId: string; username: string }; player2: { userId: string; username: string };
  };
  result: Record<string, unknown>;
  segments: TranscriptSegment[];
  submissions: { A: string; B: string };
};
export type HistoryCursor = { endedAt: number; id: string };
type Row = { id: string; created_at: number; ended_at: number; match_json: string; result_json: string; segments_json: string; submissions_json: string };

const credentialHash = (credential: string) => createHash("sha256").update(credential).digest("hex");

export class HistoryStore {
  readonly db: DatabaseSync;
  constructor(path: string) {
    if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
    const existed = path === ":memory:" || existsSync(path);
    this.db = new DatabaseSync(path);
    if (!existed) chmodSync(path, 0o600);
    this.db.exec("PRAGMA busy_timeout=5000; PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL;");
    const version = this.db.prepare("PRAGMA user_version").get() as { user_version: number };
    if (version.user_version > 1) { this.db.close(); throw new Error("History database is newer than this application"); }
    this.db.exec(readFileSync(resolve(process.cwd(), "db/history.sql"), "utf8"));
    this.db.prepare("DELETE FROM guest_sessions WHERE expires_at<=?").run(Date.now());
  }

  private transaction<T>(operation: () => T): T {
    this.db.exec("BEGIN IMMEDIATE");
    try { const result = operation(); this.db.exec("COMMIT"); return result; }
    catch (error) { this.db.exec("ROLLBACK"); throw error; }
  }

  participantOwner(id: string): string {
    return (this.db.prepare("SELECT account_id FROM guest_claims WHERE guest_id=?").get(id) as { account_id: string } | undefined)?.account_id ?? id;
  }

  save(snapshot: ArchivedMatch): boolean {
    const { match, result } = snapshot;
    if (match.status !== "ended" || result.status !== "finished" || result.matchId !== match.id ||
        !match.player1?.userId || !match.player2?.userId || match.player1.userId === match.player2.userId) throw new Error("Only completed two-participant results can be archived");
    return this.transaction(() => {
      const saved = this.db.prepare("INSERT OR IGNORE INTO history_matches VALUES(?,?,?,?,?,?,?)").run(
        match.id, match.createdAt, match.endedAt ?? Number(result.endedAt), JSON.stringify(match), JSON.stringify(result), JSON.stringify(snapshot.segments), JSON.stringify(snapshot.submissions));
      if (!saved.changes) return false;
      for (const [side, player] of [["A", match.player1], ["B", match.player2]] as const) {
        this.db.prepare("INSERT INTO history_members VALUES(?,?,?,?)").run(match.id, player.userId, this.participantOwner(player.userId), side);
      }
      return true;
    });
  }

  private decode(row: Row): ArchivedMatch {
    return { match: JSON.parse(row.match_json), result: JSON.parse(row.result_json), segments: JSON.parse(row.segments_json), submissions: JSON.parse(row.submissions_json) };
  }

  get(owner: string, id: string): ArchivedMatch | null {
    const row = this.db.prepare("SELECT m.* FROM history_matches m WHERE m.id=? AND EXISTS(SELECT 1 FROM history_members p WHERE p.match_id=m.id AND p.owner_id=?)").get(id, owner) as Row | undefined;
    return row ? this.decode(row) : null;
  }

  list(owner: string, cursor?: HistoryCursor, limit = 20) {
    const bounded = Math.max(1, Math.min(50, Math.floor(limit)));
    const rows = this.db.prepare(`SELECT m.* FROM history_matches m WHERE EXISTS(SELECT 1 FROM history_members p WHERE p.match_id=m.id AND p.owner_id=?)
      AND (? IS NULL OR m.ended_at < ? OR (m.ended_at=? AND m.id < ?)) ORDER BY m.ended_at DESC,m.id DESC LIMIT ?`).all(
        owner, cursor?.endedAt ?? null, cursor?.endedAt ?? 0, cursor?.endedAt ?? 0, cursor?.id ?? "", bounded + 1) as Row[];
    const page = rows.slice(0, bounded);
    const last = page.at(-1);
    return {
      matches: page.map(row => {
        const { match, result } = this.decode(row);
        return { id: row.id, createdAt: row.created_at, endedAt: row.ended_at, topics: match.topics, player1: match.player1, player2: match.player2, winner: result.winner, judgeVersion: result.judgeVersion };
      }),
      nextCursor: rows.length > bounded && last ? { endedAt: last.ended_at, id: last.id } : null,
    };
  }

  profile(id: string): string | null {
    return (this.db.prepare("SELECT username FROM profiles WHERE user_id=?").get(id) as { username: string } | undefined)?.username ?? null;
  }
  saveProfile(id: string, name: string) {
    if (!name.trim() || name.length > 100) throw new Error("Invalid display name");
    this.db.prepare("INSERT INTO profiles VALUES(?,?,?) ON CONFLICT(user_id) DO UPDATE SET username=excluded.username,updated_at=excluded.updated_at").run(id, name, Date.now());
  }

  rememberGuest(credential: string, id: string, expiresAt: number) {
    if (this.participantOwner(id) !== id) return false;
    this.db.prepare("INSERT OR IGNORE INTO guest_sessions VALUES(?,?,?)").run(credentialHash(credential), id, expiresAt);
    return true;
  }
  guest(credential: string): string | null {
    const row = this.db.prepare("SELECT guest_id FROM guest_sessions WHERE credential_hash=? AND expires_at>?").get(credentialHash(credential), Date.now()) as { guest_id: string } | undefined;
    return row && this.participantOwner(row.guest_id) === row.guest_id ? row.guest_id : null;
  }

  claimGuest(guest: string, account: string): { imported: number; alreadyClaimed: boolean } {
    if (!guest.startsWith("guest:") || account.startsWith("guest:") || !account) throw new Error("Invalid guest claim");
    return this.transaction(() => {
      const owner = this.participantOwner(guest);
      if (owner !== guest) {
        if (owner === account) return { imported: 0, alreadyClaimed: true };
        throw new Error("This guest history already belongs to another account");
      }
      const count = (this.db.prepare("SELECT COUNT(DISTINCT match_id) AS count FROM history_members WHERE owner_id=?").get(guest) as { count: number }).count;
      this.db.prepare("INSERT INTO guest_claims VALUES(?,?,?)").run(guest, account, Date.now());
      this.db.prepare("UPDATE history_members SET owner_id=? WHERE owner_id=?").run(account, guest);
      const username = this.profile(guest);
      if (username && !this.profile(account)) this.saveProfile(account, username);
      this.db.prepare("DELETE FROM guest_sessions WHERE guest_id=?").run(guest);
      return { imported: count, alreadyClaimed: false };
    });
  }

  close() { this.db.close(); }
}

export function historyStore(): HistoryStore {
  const path = resolve(process.env.HISTORY_DB_PATH || "data/debate-history.sqlite");
  const shared = globalThis as typeof globalThis & { debateHistoryStores?: Map<string, HistoryStore> };
  const stores = shared.debateHistoryStores ??= new Map();
  let store = stores.get(path);
  if (!store) { store = new HistoryStore(path); stores.set(path, store); }
  return store;
}
