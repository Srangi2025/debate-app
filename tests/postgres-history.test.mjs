import assert from "node:assert/strict";
import { test, before, after, beforeEach } from "node:test";
import { readFileSync } from "node:fs";
import { randomUUID, createHash } from "node:crypto";
import { HistoryStore } from "../lib/history-store.ts";
import { PostgresHistoryStore } from "../lib/postgres-history.ts";
import { importSqliteHistory } from "../lib/history-migration.ts";
import { resolveGuestCredential } from "../lib/guest-sessions.ts";
import { Client } from "pg";
import { processNextArchive } from "../lib/history-worker.ts";

const url = process.env.HISTORY_PG_TEST_URL;
const pgTest = (name, fn) => test(name, { skip: !url }, fn);
test("remote history connections require TLS certificate verification", async () => {
  assert.throws(() => new PostgresHistoryStore("invalid-sensitive-string"), error => !String(error).includes("invalid-sensitive-string"));
  assert.throws(() => new PostgresHistoryStore("postgresql://u:p@database.example/db?sslmode=disable"), /verified TLS/);
  const remote = new PostgresHistoryStore("postgresql://u:p@database.example/db?sslmode=require");
  try {
    const config = new Client(remote.pool.options).connectionParameters;
    assert.ok(config.ssl);
    assert.notEqual(config.ssl.rejectUnauthorized, false);
  } finally { await remote.close(); }
});

test("archive outbox waits for async persistence and preserves failures for retry", async () => {
  const saved = snapshot("async-archive");
  let removed = false, retried = false, persisted = false;
  const redis = {
    get: async key => key.startsWith("match:") ? saved.match : saved.result,
    hget: async () => ({ transcript: "Frozen text" }), lrange: async () => saved.segments,
    zrange: async () => [saved.match.id], zrem: async () => { assert.equal(persisted, true); removed = true; },
    zadd: async () => { retried = true; },
  };
  await processNextArchive(redis, { archive: { save: async () => { await new Promise(resolve => setTimeout(resolve, 10)); persisted = true; } } });
  assert.equal(removed, true); assert.equal(retried, false);
  removed = false;
  await processNextArchive(redis, { archive: { save: async () => { throw new Error("Storage unavailable"); } } });
  assert.equal(removed, false); assert.equal(retried, true);
});
let store;
before(async () => {
  if (!url) return;
  // This suite truncates its own schema. Refuse ordinary/production database names.
  if (!/^[a-z0-9_]*_test$/.test(new URL(url).pathname.slice(1))) throw new Error("Use a dedicated database ending in _test for HISTORY_PG_TEST_URL");
  store = new PostgresHistoryStore(url);
  assert.match((await store.pool.query("SELECT current_database() AS name")).rows[0].name, /_test$/);
  await store.pool.query("DO $$ BEGIN IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='anon') THEN CREATE ROLE anon; END IF; IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN CREATE ROLE authenticated; END IF; END $$;");
  const schema = readFileSync(new URL("../db/postgres-history.sql", import.meta.url), "utf8");
  await store.pool.query(schema);
  await store.pool.query(schema);
});
beforeEach(async () => {
  if (store) await store.pool.query("TRUNCATE ranked_debate.history_matches,ranked_debate.history_members,ranked_debate.guest_claims,ranked_debate.profiles,ranked_debate.guest_sessions");
});
after(async () => { await store?.close(); });

function snapshot(id = randomUUID(), endedAt = 2000) {
  return {
    match: { id, status: "ended", topics: ["ai-harm"], createdAt: 1000, endedAt,
      player1: { userId: "guest:a", username: "A" }, player2: { userId: "guest:b", username: "B" } },
    result: { matchId: id, status: "finished", winner: { userId: "guest:a", username: "A" } },
    segments: [{ id: "s1", userId: "guest:a", username: "A", side: "A", source: "text", text: "Original argument", createdAt: 1100 }],
    submissions: { A: "Original argument", B: "An opposing argument" },
  };
}

pgTest("Postgres archives are immutable, idempotent, and participant-filtered", async () => {
  const saved = snapshot();
  assert.equal(await store.save(saved), true);
  const changed = structuredClone(saved); changed.result.winner = "changed";
  assert.equal(await store.save(changed), false);
  assert.deepEqual(await store.get("guest:a", saved.match.id), saved);
  assert.deepEqual(await store.get("guest:b", saved.match.id), saved);
  assert.equal(await store.get("outsider", saved.match.id), null);
  assert.deepEqual((await store.list("outsider")).matches, []);
  assert.equal((await store.list("guest:a")).matches.length, 1);
});

pgTest("Postgres pages equal timestamps without repeats and binds owner input", async () => {
  for (const id of ["a", "b", "c", "d", "e"]) await store.save(snapshot(id));
  const first = await store.list("guest:a", undefined, 2), second = await store.list("guest:a", first.nextCursor, 2), third = await store.list("guest:a", second.nextCursor, 2);
  assert.deepEqual([...first.matches, ...second.matches, ...third.matches].map(m => m.id), ["e", "d", "c", "b", "a"]);
  assert.equal(third.nextCursor, null);
  assert.deepEqual((await store.list("' OR TRUE --")).matches, []);
});

pgTest("Postgres claims preserve speakers/account names and cannot be stolen", async () => {
  const saved = snapshot(); await store.save(saved);
  await store.saveProfile("guest:a", "Guest"); await store.saveProfile("account:a", "Account");
  await store.rememberGuest("cookie", "guest:a", Date.now() + 100000);
  assert.deepEqual(await store.claimGuest("guest:a", "account:a"), { imported: 1, alreadyClaimed: false });
  assert.deepEqual(await store.claimGuest("guest:a", "account:a"), { imported: 0, alreadyClaimed: true });
  await assert.rejects(store.claimGuest("guest:a", "account:b"));
  assert.deepEqual(await store.get("account:a", saved.match.id), saved);
  assert.equal(await store.get("guest:a", saved.match.id), null);
  assert.equal(await store.profile("account:a"), "Account");
  assert.equal(await store.guest("cookie"), null);
  assert.equal(await store.rememberGuest("new-cookie", "guest:a", Date.now() + 100000), false);
});

pgTest("Postgres concurrent claims have exactly one owner", async () => {
  const saved = snapshot(); await store.save(saved);
  const results = await Promise.allSettled([store.claimGuest("guest:a", "account:a"), store.claimGuest("guest:a", "account:b")]);
  assert.equal(results.filter(r => r.status === "fulfilled").length, 1);
  const owner = await store.participantOwner("guest:a");
  assert.deepEqual(await store.get(owner, saved.match.id), saved);
  assert.equal(await store.get(owner === "account:a" ? "account:b" : "account:a", saved.match.id), null);
});

pgTest("Postgres archival racing a claim always follows final ownership", async () => {
  for (let i = 0; i < 8; i++) {
    const saved = snapshot(); saved.match.player1.userId = `guest:race-${i}`;
    await Promise.all([store.save(saved), store.claimGuest(saved.match.player1.userId, "account:a")]);
    assert.deepEqual(await store.get("account:a", saved.match.id), saved);
    assert.equal(await store.get(saved.match.player1.userId, saved.match.id), null);
  }
});

pgTest("Postgres credentials are hashed, expire, and legacy migration keeps TTL", async () => {
  await store.rememberGuest("secret-cookie", "guest:a", Date.now() + 10000);
  await store.rememberGuest("expired-cookie", "guest:b", Date.now() - 1);
  const rows = (await store.pool.query("SELECT * FROM ranked_debate.guest_sessions")).rows;
  assert.equal(JSON.stringify(rows).includes("secret-cookie"), false);
  assert.equal(await store.guest("secret-cookie"), "guest:a");
  assert.equal(await store.guest("expired-cookie"), null);
  const before = Date.now();
  assert.equal(await resolveGuestCredential("legacy-cookie", store, { get: async () => "guest:legacy", ttl: async () => 12 }), "guest:legacy");
  const expiry = Number((await store.pool.query("SELECT expires_at FROM ranked_debate.guest_sessions WHERE credential_hash=$1", [createHash("sha256").update("legacy-cookie").digest("hex")])).rows[0].expires_at);
  assert.ok(expiry >= before + 12000 && expiry <= Date.now() + 12000);
});

pgTest("Postgres storage survives new connections and rejects incomplete archives", async () => {
  const saved = snapshot(); await store.save(saved);
  const other = new PostgresHistoryStore(url);
  try { assert.deepEqual(await other.get("guest:a", saved.match.id), saved); }
  finally { await other.close(); }
  await assert.rejects(store.save({ ...saved, match: { ...saved.match, id: "invalid", status: "active" } }));
  const bad = snapshot("broken"); bad.segments[0].text = 1n;
  await assert.rejects(store.save(bad));
  assert.equal(await store.get("guest:a", "broken"), null);
});

pgTest("Supabase browser roles cannot read the private history schema", async () => {
  const client = await store.pool.connect();
  try {
    for (const role of ["anon", "authenticated"]) {
      await client.query(`SET ROLE ${role}`);
      await assert.rejects(client.query("SELECT * FROM ranked_debate.history_matches"), { code: "42501" });
      await client.query("RESET ROLE");
    }
  } finally { await client.query("RESET ROLE"); client.release(); }
});

pgTest("SQLite migration preserves claims, immutable text, profiles and hashed credentials on retries", async () => {
  const source = new HistoryStore(":memory:");
  try {
    const saved = snapshot(); source.save(saved); source.saveProfile("guest:a", "Guest");
    source.claimGuest("guest:a", "account:a"); source.rememberGuest("cookie-b", "guest:b", Date.now() + 10000);
    await importSqliteHistory(source.db, store); await importSqliteHistory(source.db, store);
    assert.deepEqual(await store.get("account:a", saved.match.id), saved);
    assert.equal(await store.get("guest:a", saved.match.id), null);
    assert.equal(await store.profile("account:a"), "Guest");
    assert.equal(await store.guest("cookie-b"), "guest:b");
    assert.deepEqual(source.get("account:a", saved.match.id), saved);
  } finally { source.close(); }
});

pgTest("SQLite migration conflicts roll back the entire import", async () => {
  const source = new HistoryStore(":memory:");
  try {
    source.save(snapshot("new")); source.save(snapshot("existing")); source.claimGuest("guest:a", "account:a");
    const changed = snapshot("existing"); changed.result.winner = "different"; await store.save(changed);
    await assert.rejects(importSqliteHistory(source.db, store), /Migration conflict/);
    assert.equal(await store.get("guest:b", "new"), null);
    assert.equal(await store.participantOwner("guest:a"), "guest:a");
    assert.deepEqual(await store.get("guest:a", "existing"), changed);
  } finally { source.close(); }
});
