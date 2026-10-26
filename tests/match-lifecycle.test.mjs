import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { before, after, test } from "node:test";
import IORedis from "ioredis";
import { MATCH_LIFECYCLE_SCRIPT } from "../lib/match-lifecycle.ts";

const redis = new IORedis(process.env.REDIS_TEST_URL || "redis://127.0.0.1:6379", {
  lazyConnect: true, maxRetriesPerRequest: 1, retryStrategy: () => null,
});
redis.on("error", () => {});
before(() => redis.connect());
after(() => redis.quit());

async function fixture(t) {
  const id = `test-lifecycle:${randomUUID()}`;
  const keys = [`${id}:match`, `${id}:a:match`, `${id}:b:match`];
  t.after(() => redis.del(...keys));
  await redis.set(keys[0], JSON.stringify({
    id, status: "active", createdAt: 1000,
    player1: { userId: "a" }, player2: { userId: "b" },
  }));
  await redis.mset(keys[1], id, keys[2], id);
  return { id, keys, run: async (user, now, action = "heartbeat") => JSON.parse(
    await redis.eval(MATCH_LIFECYCLE_SCRIPT, keys.length, ...keys, user, now, action)
  ) };
}

test("heartbeats keep a room active and stale peers close it", async (t) => {
  const f = await fixture(t);
  for (const now of [50000, 100000, 150000]) {
    assert.equal((await f.run("a", now)).match.status, "active");
    assert.equal((await f.run("b", now)).match.status, "active");
  }
  const closed = await f.run("a", 271000);
  assert.equal(closed.match.status, "abandoned");
  assert.equal(closed.match.endReason, "opponent_disconnected");
  assert.equal(await redis.get(f.keys[1]), null);
  assert.equal(await redis.get(f.keys[2]), null);
});

test("leaving closes the room for both players and retries preserve newer matches", async (t) => {
  const f = await fixture(t);
  await redis.set(f.keys[1], "newer-match");
  assert.equal((await f.run("a", 2000, "leave")).match.status, "abandoned");
  assert.equal(await redis.get(f.keys[1]), "newer-match");
  assert.equal(await redis.get(f.keys[2]), null);
  assert.equal((await f.run("b", 3000, "leave")).match.status, "abandoned");
});

test("unrelated users cannot close rooms; pending judgments are not abandoned", async (t) => {
  const f = await fixture(t);
  assert.equal((await f.run("stranger", 2000, "leave")).statusCode, 403);
  const match = JSON.parse(await redis.get(f.keys[0]));
  await redis.set(f.keys[0], JSON.stringify({ ...match, status: "pending_judgment" }));
  assert.equal((await f.run("a", 3000, "leave")).match.status, "pending_judgment");
});
