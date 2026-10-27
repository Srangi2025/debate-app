import assert from "node:assert/strict";
import { test } from "node:test";
import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { HistoryStore } from "../lib/history-store.ts";
import { sameOriginRequest } from "../lib/request-origin.ts";
import { resolveGuestCredential } from "../lib/guest-sessions.ts";

test("claim origin checks accept the browser host while rejecting cross-site requests", () => {
  assert.equal(sameOriginRequest(new Request("http://localhost:3100/api/account/claim", { headers: { host: "127.0.0.1:3100", origin: "http://127.0.0.1:3100" } })), true);
  assert.equal(sameOriginRequest(new Request("http://localhost:3100/api/account/claim", { headers: { host: "localhost:3100", origin: "https://attacker.invalid" } })), false);
  assert.equal(sameOriginRequest(new Request("http://localhost:3100/api/account/claim", { headers: { host: "localhost:3100", origin: "null" } })), false);
});

function snapshot(id = randomUUID(), endedAt = 2000) {
  const player1 = { userId: "guest:a", username: "A" }, player2 = { userId: "guest:b", username: "B" };
  return { match: { id, topics: ["ai-harm"], status: "ended", createdAt: 1000, endedAt, player1, player2 },
    result: { matchId: id, status: "finished", winner: player1, judgeReason: "A more clearly addressed the motion." },
    segments: [{ id: "segment-1", userId: player1.userId, username: "A", side: "A", source: "speech", text: "The original spoken contribution.", createdAt: 1100 }],
    submissions: { A: "The original spoken contribution.", B: "An opposing contribution." } };
}
function fixture(t) {
  const store = new HistoryStore(":memory:");
  t.after(() => store.close());
  return store;
}

test("only participants can list or read frozen debates and original transcripts", t => {
  const store = fixture(t), saved = snapshot(); store.save(saved);
  assert.deepEqual(store.get("guest:a", saved.match.id), saved);
  assert.deepEqual(store.get("guest:b", saved.match.id), saved);
  assert.equal(store.get("intruder", saved.match.id), null);
  assert.deepEqual(store.list("intruder").matches, []);
  assert.deepEqual(store.list("guest:a").matches.map(item => item.id), [saved.match.id]);
});

test("retries never replace a saved result or add a new participant", t => {
  const store = fixture(t), saved = snapshot(); assert.equal(store.save(saved), true);
  const changed = structuredClone(saved); changed.result.judgeReason = "A replacement"; changed.match.player1.userId = "intruder";
  assert.equal(store.save(changed), false);
  assert.equal(store.get("intruder", saved.match.id), null);
  assert.deepEqual(store.get("guest:a", saved.match.id), saved);
});

test("unfinished or mismatched results are not archived", t => {
  const store = fixture(t), saved = snapshot();
  assert.throws(() => store.save({ ...saved, match: { ...saved.match, status: "pending_judgment" } }));
  assert.throws(() => store.save({ ...saved, result: { ...saved.result, matchId: "different" } }));
  assert.equal(store.list("guest:a").matches.length, 0);
});

test("pagination is deterministic at equal timestamps and never repeats a debate", t => {
  const store = fixture(t);
  for (const id of ["a", "b", "c", "d", "e"]) store.save(snapshot(id));
  const first = store.list("guest:a", undefined, 2), second = store.list("guest:a", first.nextCursor, 2), third = store.list("guest:a", second.nextCursor, 2);
  assert.deepEqual([...first.matches, ...second.matches, ...third.matches].map(item => item.id), ["e", "d", "c", "b", "a"]);
  assert.equal(third.nextCursor, null);
});

test("guest import changes ownership while preserving speaker IDs, names, and evidence", t => {
  const store = fixture(t), saved = snapshot(); store.save(saved); store.saveProfile("guest:a", "Saved guest");
  store.rememberGuest("secret-cookie", "guest:a", Date.now() + 10000);
  assert.deepEqual(store.claimGuest("guest:a", "account-a"), { imported: 1, alreadyClaimed: false });
  assert.equal(store.profile("account-a"), "Saved guest");
  assert.equal(store.guest("secret-cookie"), null);
  assert.equal(store.get("guest:a", saved.match.id), null);
  assert.deepEqual(store.get("account-a", saved.match.id), saved);
  assert.deepEqual(store.get("guest:b", saved.match.id), saved);
  assert.equal(store.get("account-b", saved.match.id), null);
});

test("claims are idempotent, cannot be stolen, and preserve an existing account name", t => {
  const store = fixture(t); store.save(snapshot()); store.saveProfile("account-a", "Account name"); store.saveProfile("guest:a", "Guest name");
  store.claimGuest("guest:a", "account-a");
  assert.deepEqual(store.claimGuest("guest:a", "account-a"), { imported: 0, alreadyClaimed: true });
  assert.throws(() => store.claimGuest("guest:a", "account-b"), /another account/);
  assert.equal(store.profile("account-a"), "Account name");
  assert.equal(store.list("account-b").matches.length, 0);
});

test("late archive delivery follows an already-imported guest to the account", t => {
  const store = fixture(t), saved = snapshot();
  store.claimGuest("guest:a", "account-a"); store.save(saved);
  assert.equal(store.list("account-a").matches.length, 1);
  assert.equal(store.list("guest:a").matches.length, 0);
});

test("one account owning both historical sides sees one debate, not duplicates", t => {
  const store = fixture(t); store.save(snapshot());
  store.claimGuest("guest:a", "account-a"); store.claimGuest("guest:b", "account-a");
  assert.equal(store.list("account-a").matches.length, 1);
});

test("display names and owner filters use bound SQL parameters", t => {
  const store = fixture(t); store.save(snapshot()); const name = "'); DROP TABLE profiles; --";
  store.saveProfile("guest:a", name);
  assert.equal(store.profile("guest:a"), name);
  assert.deepEqual(store.list("guest:a' OR 1=1 --").matches, []);
  assert.equal(store.get("intruder", "' OR 1=1 --"), null);
});

test("expired credentials cannot restore a guest; raw credentials are not stored", t => {
  const store = fixture(t); store.rememberGuest("private-cookie", "guest:a", Date.now() + 10000);
  store.rememberGuest("expired-cookie", "guest:b", Date.now() - 1);
  assert.equal(store.guest("private-cookie"), "guest:a");
  assert.equal(store.guest("expired-cookie"), null);
  const rows = store.db.prepare("SELECT * FROM guest_sessions").all();
  assert.ok(!JSON.stringify(rows).includes("private-cookie"));
});

test("legacy guest migration preserves remaining TTL and then survives Redis loss", async t => {
  const store = fixture(t), started = Date.now();
  const legacy = { get: async () => "guest:a", ttl: async () => 60 };
  assert.equal(await resolveGuestCredential("cookie", store, legacy), "guest:a");
  const row = store.db.prepare("SELECT expires_at FROM guest_sessions").get();
  assert.ok(row.expires_at >= started + 60000 && row.expires_at <= Date.now() + 60000);
  const unavailable = { get: async () => { throw new Error("Redis unavailable"); }, ttl: async () => { throw new Error("Redis unavailable"); } };
  assert.equal(await resolveGuestCredential("cookie", store, unavailable), "guest:a");
});

test("expired Redis credentials and retired guest cookies cannot be revived", async t => {
  const store = fixture(t);
  assert.equal(await resolveGuestCredential("expired", store, { get: async () => "guest:a", ttl: async () => -2 }), null);
  store.claimGuest("guest:a", "account-a");
  assert.equal(await resolveGuestCredential("retired", store, { get: async () => "guest:a", ttl: async () => 1000 }), null);
});

test("history, profile, and guest identity survive process-style reopen and a verified backup", t => {
  const dir = mkdtempSync(join(tmpdir(), "debate-history-test-")); t.after(() => rmSync(dir, { recursive: true, force: true }));
  const path = join(dir, "history.sqlite"), backup = join(dir, "backup.sqlite");
  let store = new HistoryStore(path); const saved = snapshot(); store.save(saved); store.saveProfile("guest:a", "Persistent"); store.rememberGuest("cookie", "guest:a", Date.now() + 100000); store.close();
  store = new HistoryStore(path); assert.deepEqual(store.get("guest:a", saved.match.id), saved); assert.equal(store.profile("guest:a"), "Persistent"); assert.equal(store.guest("cookie"), "guest:a"); store.close();
  const run = spawnSync(process.execPath, ["scripts/history-db.mjs", "backup", backup], { env: { ...process.env, HISTORY_DB_PATH: path }, encoding: "utf8" });
  assert.equal(run.status, 0, run.stderr);
  const restored = new HistoryStore(backup); assert.deepEqual(restored.get("guest:a", saved.match.id), saved); restored.close();
  const repeat = spawnSync(process.execPath, ["scripts/history-db.mjs", "backup", backup], { env: { ...process.env, HISTORY_DB_PATH: path }, encoding: "utf8" });
  assert.equal(repeat.status, 1, "Existing backups must not be overwritten");
});
