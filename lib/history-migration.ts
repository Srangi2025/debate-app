import type { DatabaseSync } from "node:sqlite";
import { isDeepStrictEqual } from "node:util";
import type { PostgresHistoryStore } from "./postgres-history.ts";

/** One snapshot + one target transaction. Conflicts abort; neither source nor existing rows are replaced. */
export async function importSqliteHistory(source: DatabaseSync, target: PostgresHistoryStore) {
  const version = source.prepare("PRAGMA user_version").get() as { user_version: number };
  if (version.user_version !== 1) throw new Error("Expected a version 1 history database");
  if ((source.prepare("PRAGMA quick_check").get() as { quick_check: string }).quick_check !== "ok") throw new Error("Source database integrity check failed");
  source.exec("BEGIN");
  let data;
  try {
    data = {
      matches: source.prepare("SELECT * FROM history_matches").all(),
      members: source.prepare("SELECT * FROM history_members").all(),
      claims: source.prepare("SELECT * FROM guest_claims").all(),
      profiles: source.prepare("SELECT * FROM profiles").all(),
      sessions: source.prepare("SELECT * FROM guest_sessions WHERE expires_at>?").all(Date.now()),
    };
    source.exec("COMMIT");
  } catch (error) { source.exec("ROLLBACK"); throw error; }
  const client = await target.pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT pg_advisory_xact_lock(736284109)");
    const check = (condition: boolean) => { if (!condition) throw new Error("Migration conflict: target differs from source; no records were replaced"); };
    for (const row of data.claims) {
      const existing = (await client.query("SELECT account_id FROM ranked_debate.guest_claims WHERE guest_id=$1", [row.guest_id])).rows[0];
      check(!existing || existing.account_id === row.account_id);
      await client.query("INSERT INTO ranked_debate.guest_claims VALUES($1,$2,$3) ON CONFLICT DO NOTHING", [row.guest_id, row.account_id, row.claimed_at]);
      await client.query("UPDATE ranked_debate.history_members SET owner_id=$1 WHERE owner_id=$2", [row.account_id, row.guest_id]);
      await client.query("DELETE FROM ranked_debate.guest_sessions WHERE guest_id=$1", [row.guest_id]);
    }
    for (const row of data.matches) {
      const snapshot = { match: JSON.parse(String(row.match_json)), result: JSON.parse(String(row.result_json)), segments: JSON.parse(String(row.segments_json)), submissions: JSON.parse(String(row.submissions_json)) };
      const existing = (await client.query("SELECT snapshot,created_at,ended_at FROM ranked_debate.history_matches WHERE id=$1", [row.id])).rows[0];
      check(!existing || (isDeepStrictEqual(existing.snapshot, snapshot) && Number(existing.created_at) === Number(row.created_at) && Number(existing.ended_at) === Number(row.ended_at)));
      await client.query("INSERT INTO ranked_debate.history_matches VALUES($1,$2,$3,$4) ON CONFLICT DO NOTHING", [row.id, row.created_at, row.ended_at, JSON.stringify(snapshot)]);
    }
    for (const row of data.members) {
      const owner = (await client.query("SELECT account_id FROM ranked_debate.guest_claims WHERE guest_id=$1", [row.participant_id])).rows[0]?.account_id ?? row.owner_id;
      const existing = (await client.query("SELECT owner_id,side FROM ranked_debate.history_members WHERE match_id=$1 AND participant_id=$2", [row.match_id, row.participant_id])).rows[0];
      check(!existing || (existing.owner_id === owner && existing.side === row.side));
      await client.query("INSERT INTO ranked_debate.history_members VALUES($1,$2,$3,$4) ON CONFLICT DO NOTHING", [row.match_id, row.participant_id, owner, row.side]);
    }
    // Existing target names win; never replace an account name during a retry.
    for (const row of data.profiles) await client.query("INSERT INTO ranked_debate.profiles VALUES($1,$2,$3) ON CONFLICT DO NOTHING", [row.user_id, row.username, row.updated_at]);
    for (const row of data.sessions) {
      if ((await client.query("SELECT 1 FROM ranked_debate.guest_claims WHERE guest_id=$1", [row.guest_id])).rowCount) continue;
      const existing = (await client.query("SELECT guest_id,expires_at FROM ranked_debate.guest_sessions WHERE credential_hash=$1", [row.credential_hash])).rows[0];
      check(!existing || existing.guest_id === row.guest_id);
      await client.query(`INSERT INTO ranked_debate.guest_sessions VALUES($1,$2,$3) ON CONFLICT(credential_hash)
        DO UPDATE SET expires_at=LEAST(ranked_debate.guest_sessions.expires_at,excluded.expires_at)`, [row.credential_hash, row.guest_id, row.expires_at]);
    }
    await client.query("COMMIT");
    return Object.fromEntries(Object.entries(data).map(([key, rows]) => [key, rows.length]));
  } catch (error) { await client.query("ROLLBACK").catch(() => {}); throw error; }
  finally { client.release(); }
}
