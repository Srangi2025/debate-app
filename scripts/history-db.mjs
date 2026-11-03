import nextEnv from "@next/env";
import { backup, DatabaseSync } from "node:sqlite";
import { existsSync, mkdirSync, chmodSync } from "node:fs";
import { resolve, dirname } from "node:path";
nextEnv.loadEnvConfig(process.cwd(), process.env.NODE_ENV !== "production");
const { historyStore } = await import("../lib/history-store.ts");
const store = historyStore();
const command = process.argv[2] || "check";
try {
  if (command === "backup") {
    if (!("db" in store)) throw new Error("Postgres backups must use Supabase backups or pg_dump; this command backs up SQLite only");
    const destination = resolve(process.argv[3] || `data/backups/history-${new Date().toISOString().replace(/[:.]/g, "-")}.sqlite`);
    if (existsSync(destination)) throw new Error("Backup destination already exists; choose a new file");
    mkdirSync(dirname(destination), { recursive: true, mode: 0o700 });
    await backup(store.db, destination);
    chmodSync(destination, 0o600);
    const verified = new DatabaseSync(destination, { readOnly: true });
    try { if (verified.prepare("PRAGMA quick_check").get().quick_check !== "ok") throw new Error("Backup integrity check failed"); }
    finally { verified.close(); }
    console.log(`Verified history backup: ${destination}`);
  } else if (command === "backfill") {
    const { redis } = await import("../lib/redis.ts");
    const { archiveMatch } = await import("../lib/history-worker.ts");
    let cursor = "0", saved = 0, skipped = 0, sessions = 0, profiles = 0;
    do {
      const page = await redis.scan(cursor, { match: "match:*", count: 100, type: "string" });
      cursor = String(page[0]);
      for (const key of page[1]) {
        const match = await redis.get(key);
        if (!match || typeof match !== "object" || match.status !== "ended" || !match.id || key !== `match:${match.id}`) continue;
        try { await archiveMatch(redis, match.id, store); saved++; }
        catch { skipped++; }
      }
    } while (cursor !== "0");
    cursor = "0";
    do {
      const page = await redis.scan(cursor, { match: "guest-session:*", count: 100, type: "string" });
      cursor = String(page[0]);
      for (const key of page[1]) {
        const [id, ttl] = await Promise.all([redis.get(key), redis.ttl(key)]);
        if (typeof id === "string" && id.startsWith("guest:") && ttl > 0 && await store.rememberGuest(key.slice("guest-session:".length), id, Date.now() + Math.min(ttl, 30 * 86400) * 1000)) sessions++;
      }
    } while (cursor !== "0");
    const legacyNames = await redis.hgetall("users:usernames") || {};
    for (const [id, value] of Object.entries(legacyNames)) {
      if (!["string", "number", "boolean"].includes(typeof value)) continue;
      const name = String(value);
      if (name.trim() && name.length <= 100 && !await store.profile(id)) { await store.saveProfile(id, name); profiles++; }
    }
    console.log(`Completed debate backfill: ${saved} archived or already saved, ${skipped} missing required records. Source records were preserved.`);
    console.log(`Preserved ${sessions} unexpired guest sessions as hashes and ${profiles} legacy names.`);
  } else if (command === "check") {
    if ("db" in store) {
      console.log("History backend: SQLite");
      console.log("History integrity:", store.db.prepare("PRAGMA quick_check").get().quick_check);
      console.log("Archived debates:", store.db.prepare("SELECT COUNT(*) AS count FROM history_matches").get().count);
    } else {
      const { rows } = await store.pool.query("SELECT COUNT(*) AS count FROM ranked_debate.history_matches");
      // Exercise every required relation without exposing any stored data.
      for (const table of ["history_members", "profiles", "guest_sessions", "guest_claims"]) await store.pool.query(`SELECT 1 FROM ranked_debate.${table} LIMIT 0`);
      console.log("History backend: PostgreSQL; schema reachable");
      console.log("Archived debates:", rows[0].count);
    }
  } else throw new Error("Use check, backup [new destination], or backfill");
} catch (error) { console.error(error.message); process.exitCode = 1; }
finally { await store.close(); }
// A TCP Redis connection from backfill otherwise keeps this short-lived CLI alive.
process.exit(process.exitCode ?? 0);
