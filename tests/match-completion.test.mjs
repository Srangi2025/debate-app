import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, test } from "node:test";
import IORedis from "ioredis";
import { Redis } from "@upstash/redis";
import { MATCH_COMPLETION_SCRIPT } from "../lib/match-completion.ts";

const tcp = new IORedis(process.env.REDIS_TEST_URL || "redis://127.0.0.1:6379", {
  lazyConnect: true,
  maxRetriesPerRequest: 1,
  retryStrategy: () => null,
});
tcp.on("error", () => {});
// Exercise the same Upstash decoding used by the app, backed by real Redis.
const redis = new Redis({
  async request({ body: [command, ...args] }) {
    return { result: await tcp.call(command, ...args) };
  },
});

before(() => tcp.connect());
after(() => tcp.quit());

async function fixture(t) {
  const id = `test-completion-${randomUUID()}`;
  const player1 = { userId: `test-player1-${randomUUID()}`, username: "First" };
  const player2 = { userId: `test-player2-${randomUUID()}`, username: "Second" };
  const keys = [
    `match:${id}`, `match:${id}:submissions`, `result:${id}`,
    `user:${player1.userId}:match`, `user:${player2.userId}:match`,
  ];
  t.after(() => redis.del(...keys));
  await redis.set(keys[0], { id, player1, player2, topics: ["ai-harm"], status: "active", createdAt: Date.now() });
  await Promise.all([redis.set(keys[3], id), redis.set(keys[4], id)]);
  const submit = (userId, transcript, now = Date.now()) => redis.eval(
    MATCH_COMPLETION_SCRIPT, keys,
    [userId, JSON.stringify({ userId, transcript, transcriptLength: transcript.length, submittedAt: now }), now, `/result/${id}`]
  );
  return { id, player1, player2, keys, submit };
}

test("first submission waits, retries preserve it, and the second produces a shared result", async (t) => {
  const f = await fixture(t);
  assert.equal((await f.submit(f.player1.userId, "First response")).status, "waiting");
  assert.equal(await tcp.ttl(f.keys[1]), -1, "Active submissions must not expire while waiting");
  assert.equal(await redis.get(f.keys[2]), null);
  assert.equal((await f.submit(f.player1.userId, "A replacement that must not be saved")).status, "waiting");
  const saved = await redis.hget(f.keys[1], f.player1.userId);
  assert.equal(typeof saved, "object", "SDK HGET already deserializes JSON");
  assert.equal(saved.transcript, "First response");
  assert.equal((await f.submit(f.player2.userId, "A substantially longer second response")).status, "completed");
  const result = await redis.get(f.keys[2]);
  assert.equal(result.winner.userId, f.player2.userId);
  assert.equal(result.judgeMethod, "response-length");
  assert.match(result.judgeReason, /Argument quality was not evaluated/);
  assert.equal((await redis.get(f.keys[0])).status, "ended");
  assert.ok(await tcp.ttl(f.keys[1]) > 0, "Completed submissions have a cleanup expiry");
  assert.equal(await redis.get(f.keys[3]), null);
  assert.equal(await redis.get(f.keys[4]), null);
});

test("simultaneous submissions and retries leave one stable result", async (t) => {
  const f = await fixture(t);
  const replies = await Promise.all([
    f.submit(f.player1.userId, "Short", 100),
    f.submit(f.player2.userId, "A much longer response", 200),
    f.submit(f.player1.userId, "Short", 300),
    f.submit(f.player2.userId, "A much longer response", 400),
  ]);
  assert.ok(replies.some(r => r.status === "completed"));
  const result = await redis.get(f.keys[2]);
  const submissions = await redis.hgetall(f.keys[1]);
  const retry = await f.submit(f.player1.userId, "Changed after completion", 500);
  assert.equal(retry.alreadyCompleted, true);
  assert.deepEqual(await redis.get(f.keys[2]), result);
  assert.deepEqual(await redis.hgetall(f.keys[1]), submissions);
});

test("unrelated players cannot submit or complete the match", async (t) => {
  const f = await fixture(t);
  assert.equal((await f.submit("unrelated-player", "Not my match")).statusCode, 403);
  assert.equal(await redis.hexists(f.keys[1], "unrelated-player"), 0);
  assert.equal(await redis.get(f.keys[2]), null);
});

test("completion and old-match retries preserve a newer active match", async (t) => {
  const f = await fixture(t);
  await f.submit(f.player1.userId, "First response");
  await redis.set(f.keys[3], "newer-active-match");
  await f.submit(f.player2.userId, "Second response");
  assert.equal(await redis.get(f.keys[3]), "newer-active-match");
  await f.submit(f.player1.userId, "Retry");
  assert.equal(await redis.get(f.keys[3]), "newer-active-match");
});

test("older submissions and Unicode text retain the existing length rules", async (t) => {
  const f = await fixture(t);
  await redis.hset(f.keys[1], {
    [f.player1.userId]: JSON.stringify({ userId: f.player1.userId, transcript: "😀", submittedAt: 1 }),
  });
  await f.submit(f.player2.userId, "ab");
  const result = await redis.get(f.keys[2]);
  assert.equal(result.winner.userId, f.player1.userId);
  assert.match(result.judgeReason, /equal length/);
});

test("missing or incomplete matches produce explicit errors", async (t) => {
  const f = await fixture(t);
  const match = await redis.get(f.keys[0]);
  await redis.set(f.keys[0], { ...match, player2: null });
  assert.equal((await f.submit(f.player1.userId, "Response")).statusCode, 409);
  await redis.del(f.keys[0]);
  assert.equal((await f.submit(f.player1.userId, "Response")).statusCode, 404);
});
