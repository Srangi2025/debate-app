import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, test } from "node:test";
import IORedis from "ioredis";
import { QUEUE_SCRIPT } from "../lib/matchmaking.ts";

const redis = new IORedis(process.env.REDIS_TEST_URL || "redis://127.0.0.1:6379", {
  lazyConnect: true, maxRetriesPerRequest: 1, retryStrategy: () => null,
});
redis.on("error", () => {});
before(() => redis.connect());
after(() => redis.quit());

function fixture(t) {
  const prefix = `test-matchmaking:${randomUUID()}:`;
  t.after(async () => {
    const keys = await redis.keys(`${prefix}*`);
    if (keys.length) await redis.del(...keys);
  });
  const run = async (user, now, action = "join", topics = ["ai-harm"], rating = 1500) => JSON.parse(
    await redis.eval(QUEUE_SCRIPT, 0, user, now, action, user,
      JSON.stringify(topics), randomUUID(), prefix, rating)
  );
  const seedWaiting = async (user, { joinedAt = 1000, lastSeenAt = 1000, topics = ["ai-harm"], rating = 1500 } = {}) => {
    await redis.set(`${prefix}user:${user}:queue`, JSON.stringify({ userId: user, username: user, joinedAt, lastSeenAt, topics, rating }));
    for (const topic of topics) await redis.zadd(`${prefix}queue:topic:${topic}`, joinedAt, user);
  };
  return { run, prefix, seedWaiting };
}

async function assertPopulation(prefix, users, expectedPairs, expectedWaiting) {
  const keys = await redis.keys(`${prefix}match:*`);
  assert.equal(keys.length, expectedPairs);
  const participants = new Set();
  for (const key of keys) {
    const match = JSON.parse(await redis.get(key));
    assert.equal(match.status, "active");
    assert.ok(match.topics.length > 0);
    assert.notEqual(match.player1.userId, match.player2.userId);
    for (const player of [match.player1, match.player2]) {
      assert.ok(users.includes(player.userId));
      assert.equal(participants.has(player.userId), false, "Nobody may appear in two rooms");
      participants.add(player.userId);
      assert.equal(await redis.get(`${prefix}user:${player.userId}:match`), match.id);
      assert.equal(await redis.get(`${prefix}user:${player.userId}:queue`), null);
      for (const topic of ["ai-harm", "free-college"]) {
        assert.equal(await redis.zscore(`${prefix}queue:topic:${topic}`, player.userId), null);
      }
    }
  }
  const waiting = [];
  for (const user of users) if (!participants.has(user)) {
    assert.ok(await redis.get(`${prefix}user:${user}:queue`));
    assert.equal(await redis.get(`${prefix}user:${user}:match`), null);
    waiting.push(user);
  }
  assert.equal(waiting.length, expectedWaiting);
  return waiting;
}

for (const count of [3, 4, 10, 101]) {
  test(`${count} simultaneous players produce ${Math.floor(count / 2)} distinct pairs and ${count % 2} waiting`, async (t) => {
    const { run, prefix } = fixture(t);
    const users = Array.from({ length: count }, (_, i) => `player-${i}`);
    await Promise.all(users.map(user => run(user, 1000, "join", ["ai-harm", "free-college"])));
    await Promise.all(users.map(user => run(user, 2000, "status")));
    const waiting = await assertPopulation(prefix, users, Math.floor(count / 2), count % 2);
    if (waiting.length) {
      const next = await run("next-arrival", 3000);
      assert.equal(next.matched, true);
      assert.equal((await run(waiting[0], 3001, "status")).matchId, next.matchId);
      await assertPopulation(prefix, [...users, "next-arrival"], Math.ceil(count / 2), 0);
    }
  });
}

test("repeated concurrent joins and status polls never allocate a player twice", async (t) => {
  const { run, prefix } = fixture(t);
  const users = Array.from({ length: 10 }, (_, i) => `player-${i}`);
  await Promise.all(users.flatMap(user => Array.from({ length: 5 }, () => run(user, 1000))));
  await Promise.all(users.flatMap(user => Array.from({ length: 5 }, () => run(user, 2000, "status"))));
  await assertPopulation(prefix, users, 5, 0);
});

test("topic pools match independently and keep incompatible players waiting", async (t) => {
  const { run, prefix } = fixture(t);
  await Promise.all([
    run("ai-1", 1000), run("college-1", 1000, "join", ["free-college"]),
    run("ai-2", 1000), run("college-2", 1000, "join", ["free-college"]),
    run("remote-1", 1000, "join", ["remote-work"]),
  ]);
  await assertPopulation(prefix, ["ai-1", "ai-2", "college-1", "college-2", "remote-1"], 2, 1);
});

test("an eligible opponent is found across multiple pages of incompatible players", async (t) => {
  const { run, prefix, seedWaiting } = fixture(t);
  for (let i = 0; i < 80; i++) await seedWaiting(`low-${i}`, { rating: 0 });
  await seedWaiting("eligible", { joinedAt: 1001, lastSeenAt: 1001 });
  const reply = await run("arriving", 1002);
  assert.equal(reply.matched, true);
  const match = JSON.parse(await redis.get(`${prefix}match:${reply.matchId}`));
  assert.equal(match.player1.userId, "eligible");
});

test("expired entries removed during pagination do not skip an eligible opponent", async (t) => {
  const { run, prefix, seedWaiting } = fixture(t);
  for (let i = 0; i < 70; i++) {
    await seedWaiting(`entry-${i}`, { joinedAt: 1000 + i, lastSeenAt: i % 2 ? 131000 : 1000, rating: 0 });
  }
  await seedWaiting("eligible", { joinedAt: 2000, lastSeenAt: 131000 });
  const reply = await run("arriving", 131001);
  assert.equal(reply.matched, true);
  assert.equal(JSON.parse(await redis.get(`${prefix}match:${reply.matchId}`)).player1.userId, "eligible");
});

test("stale match pointers on waiting opponents are repaired before selection", async (t) => {
  const { run, prefix, seedWaiting } = fixture(t);
  await seedWaiting("waiting");
  await redis.set(`${prefix}user:waiting:match`, "deleted-match");
  const reply = await run("arriving", 2000);
  assert.equal(reply.matched, true);
  assert.equal(JSON.parse(await redis.get(`${prefix}match:${reply.matchId}`)).player1.userId, "waiting");
});

test("keepalive polling does not move the player behind later arrivals", async (t) => {
  const { run, prefix } = fixture(t);
  await run("first", 1000);
  await run("first", 2000, "status");
  assert.equal(Number(await redis.zscore(`${prefix}queue:topic:ai-harm`, "first")), 1000);
});

test("heartbeats preserve oldest-eligible-first priority", async (t) => {
  const { run, prefix, seedWaiting } = fixture(t);
  await seedWaiting("oldest", { joinedAt: 1000, lastSeenAt: 20000, rating: 1450 });
  await seedWaiting("newer", { joinedAt: 10000, lastSeenAt: 20000, rating: 1500 });
  const paired = await run("arriving", 20001);
  const match = JSON.parse(await redis.get(`${prefix}match:${paired.matchId}`));
  assert.equal(match.player1.userId, "oldest");
});

test("rating restrictions widen with waiting time", async (t) => {
  const { run, seedWaiting } = fixture(t);
  await seedWaiting("high", { rating: 2500 });
  assert.equal((await run("low", 1000, "join", ["ai-harm"], 1000)).queued, true);
  assert.equal((await run("low", 20999, "status")).queued, true);
  assert.equal((await run("low", 31000, "status")).matched, true);
});

test("separate players with a shared topic receive the same match", async (t) => {
  const { run } = fixture(t);
  assert.equal((await run("a", 1000)).queued, true);
  const paired = await run("b", 2000);
  assert.equal(paired.matched, true);
  assert.equal((await run("a", 3000, "status")).matchId, paired.matchId);
});

test("polling keeps a waiting player matchable beyond two minutes", async (t) => {
  const { run, prefix } = fixture(t);
  await run("a", 1000);
  for (const now of [51000, 101000, 151000]) {
    assert.equal((await run("a", now, "status")).queued, true);
  }
  const entry = JSON.parse(await redis.get(`${prefix}user:a:queue`));
  assert.equal(entry.joinedAt, 1000, "Preserve wait time for rating expansion");
  assert.equal(entry.lastSeenAt, 151000);
  assert.equal((await run("b", 152000)).matched, true);
});

test("an inactive queue entry expires and can rejoin", async (t) => {
  const { run } = fixture(t);
  await run("a", 1000);
  assert.equal((await run("b", 122000)).matched, false);
  assert.equal((await run("a", 123000, "status")).queued, false);
  assert.equal((await run("a", 124000)).matched, true);
});

test("a player cannot match themselves or a player with unrelated topics", async (t) => {
  const { run } = fixture(t);
  await run("a", 1000);
  assert.equal((await run("a", 2000)).matched, false);
  assert.equal((await run("b", 3000, "join", ["free-college"])).matched, false);
});

test("missing and ended match pointers do not prevent joining", async (t) => {
  const { run, prefix } = fixture(t);
  await redis.set(`${prefix}user:a:match`, "missing");
  assert.equal((await run("a", 1000)).queued, true);
  await redis.set(`${prefix}match:old`, JSON.stringify({ status: "ended" }));
  await redis.set(`${prefix}user:b:match`, "old");
  assert.equal((await run("b", 2000)).matched, true);
});

test("abandoned active rooms release both players for new matches", async (t) => {
  const { run, prefix } = fixture(t);
  await run("a", 1000);
  const old = await run("b", 2000);
  assert.equal((await run("a", 123000)).queued, true);
  const match = JSON.parse(await redis.get(`${prefix}match:${old.matchId}`));
  assert.equal(match.status, "abandoned");
  assert.equal(await redis.get(`${prefix}user:b:match`), null);
  const next = await run("c", 124000);
  assert.equal(next.matched, true);
  assert.notEqual(next.matchId, old.matchId);
});

test("cancelling the queue after a simultaneous match releases both players", async (t) => {
  const { run, prefix } = fixture(t);
  await run("a", 1000);
  const paired = await run("b", 2000);
  await run("a", 2001, "leave");
  assert.equal(JSON.parse(await redis.get(`${prefix}match:${paired.matchId}`)).status, "abandoned");
  assert.equal(await redis.get(`${prefix}user:a:match`), null);
  assert.equal(await redis.get(`${prefix}user:b:match`), null);
});
