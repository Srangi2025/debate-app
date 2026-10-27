import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { before, after, test } from "node:test";
import IORedis from "ioredis";
import { Redis } from "@upstash/redis";
import { HistoryStore } from "../lib/history-store.ts";
import { processNextArchive } from "../lib/history-worker.ts";
import { processNextJudgment } from "../lib/judging-worker.ts";
import { APPEND_TRANSCRIPT_SCRIPT } from "../lib/transcript.ts";
import { MATCH_COMPLETION_SCRIPT } from "../lib/match-completion.ts";
import { QUEUE_SCRIPT } from "../lib/matchmaking.ts";
import { RESERVE_GUEST_CLAIM_SCRIPT } from "../lib/guest-claim.ts";

const tcp = new IORedis(process.env.REDIS_TEST_URL || "redis://127.0.0.1:6379", { lazyConnect: true, maxRetriesPerRequest: 1, retryStrategy: () => null });
tcp.on("error", () => {});
const redis = new Redis({ async request({ body: [command, ...args] }) { return { result: await tcp.call(command, ...args) }; } });
before(() => tcp.connect()); after(() => tcp.quit());
const judgment = { winner: "A", reasoning: "A substantiated the relevant premise more clearly.",
  scores: { A: { reasoning: 8, evidence: 6, rebuttals: 7, relevance: 9 }, B: { reasoning: 6, evidence: 5, rebuttals: 5, relevance: 7 } },
  weighted_scores: { A: 7.45, B: 5.7 }, strengths: { A: ["Clear"], B: ["Relevant"] }, improvements: { A: ["More evidence"], B: ["Rebut the premise"] },
  judge_version: "test", rubric_version: "debate-rubric-v1", source_checks: [], evidence_used: [],
  review: { mode: "full", characters: { A: 30, B: 30 }, chunks: { A: 1, B: 1 }, context_tokens: 16384, checked_claims: 0, candidate_claims: 0, warnings: [] } };

async function fixture(t) {
  const id = "test-history-" + randomUUID(), prefix = id + ":";
  const a = "guest:" + randomUUID(), b = "guest:" + randomUUID();
  const match = { id, status: "active", topics: ["ai-harm"], createdAt: 1000, player1: { userId: a, username: "A" }, player2: { userId: b, username: "B" } };
  const archive = new HistoryStore(":memory:");
  const keys = [`match:${id}`, `match:${id}:submissions`, `result:${id}`, `user:${a}:match`, `user:${b}:match`, prefix + "judging", prefix + "job:" + id, `match:${id}:transcript`, `match:${id}:transcript-ids`, `match:${id}:transcript-lengths`, prefix + "live", `match:${id}:feedback-state`, `match:${id}:judging-lock`, prefix + "archive"];
  t.after(async () => { archive.close(); await redis.del(...keys); });
  await redis.set(keys[0], match);
  for (const [uid, text] of [[a, "A saved spoken contribution."], [b, "An opposing typed contribution."]]) {
    await redis.eval(APPEND_TRANSCRIPT_SCRIPT, [keys[0], keys[1], keys[7], keys[8], keys[9], keys[10], keys[11]], [uid, randomUUID(), text, uid === a ? "speech" : "text", 1100, text.length]);
  }
  const submit = uid => redis.eval(MATCH_COMPLETION_SCRIPT, keys.slice(0, 8), [uid, "", 1200, `/result/${id}`, "captured"]);
  const options = { queueKey: keys[5], jobPrefix: prefix + "job:", historyQueueKey: keys[13], now: () => 1300, evaluate: async () => judgment };
  return { id, a, b, keys, archive, submit, options, match };
}

test("saved speech/text goes through immutable submissions, judging, and durable private history", async t => {
  const f = await fixture(t);
  assert.equal((await f.submit(f.a)).status, "waiting");
  assert.equal((await f.submit(f.b)).status, "pending_judgment");
  await processNextJudgment(redis, f.options);
  assert.equal(await redis.zscore(f.keys[13], f.id), 1300, "Finalization atomically publishes archive work");
  await processNextArchive(redis, { queueKey: f.keys[13], now: () => 1400, archive: f.archive });
  const saved = f.archive.get(f.a, f.id);
  assert.equal(saved.submissions.A, "A saved spoken contribution.");
  assert.equal(saved.submissions.B, "An opposing typed contribution.");
  assert.deepEqual(saved.result.review, judgment.review);
  assert.deepEqual(saved.result.sourceChecks, []);
  assert.deepEqual(saved.segments.map(item => item.source), ["speech", "text"]);
  assert.deepEqual(f.archive.get(f.b, f.id), saved);
  assert.equal(f.archive.get("intruder", f.id), null);
  await redis.del(f.keys[0], f.keys[1], f.keys[2], f.keys[7]);
  assert.deepEqual(f.archive.get(f.a, f.id), saved, "Archive reads do not depend on Redis retaining the room");
});

test("archive outage retries without replacing the final result or frozen submissions", async t => {
  const f = await fixture(t); await f.submit(f.a); await f.submit(f.b); await processNextJudgment(redis, f.options);
  const saved = await redis.get(f.keys[2]);
  const broken = { save() { throw new Error("Disk unavailable"); } };
  await processNextArchive(redis, { queueKey: f.keys[13], now: () => 1400, archive: broken });
  assert.equal(await redis.zscore(f.keys[13], f.id), 6400);
  assert.deepEqual(await redis.get(f.keys[2]), saved);
  assert.ok(await redis.hget(f.keys[1], f.a));
  await Promise.all([1, 2].map(() => processNextArchive(redis, { queueKey: f.keys[13], now: () => 6400, archive: f.archive })));
  assert.equal(f.archive.list(f.a).matches.length, 1);
  assert.equal(await redis.zscore(f.keys[13], f.id), null);
});

test("guest claim reservations block active rooms, queues, and concurrent guest joins", async t => {
  const guest = "guest:" + randomUUID(), account = randomUUID(), id = "test-claim-" + randomUUID();
  const keys = [`user:${guest}:queue`, `user:${guest}:match`, `match:${id}`, `identity:${guest}:retired`];
  t.after(() => redis.del(...keys));
  const reserve = () => redis.eval(RESERVE_GUEST_CLAIM_SCRIPT, [], [guest, account, 1000]);
  await redis.set(keys[0], { lastSeenAt: 1000, topics: [] }); assert.equal((await reserve()).statusCode, 409);
  await redis.del(keys[0]); await redis.set(keys[1], id); await redis.set(keys[2], { status: "active" });
  assert.equal((await reserve()).statusCode, 409);
  await redis.del(keys[1]); assert.equal((await reserve()).ok, true);
  const joined = await redis.eval(QUEUE_SCRIPT, [], [guest, 1000, "join", "Guest", JSON.stringify(["ai-harm"]), randomUUID(), "", 1500]);
  assert.equal(joined.statusCode, 409); assert.equal(await redis.get(keys[0]), null);
});

test("expired queue presence does not permanently prevent a guest import", async t => {
  const guest = "guest:" + randomUUID(), account = randomUUID(), topic = "test-claim-topic-" + randomUUID();
  t.after(() => redis.del(`user:${guest}:queue`, `identity:${guest}:retired`, `queue:topic:${topic}`));
  await redis.set(`user:${guest}:queue`, { lastSeenAt: 1000, topics: [topic] });
  await redis.zadd(`queue:topic:${topic}`, { score: 1000, member: guest });
  const result = await redis.eval(RESERVE_GUEST_CLAIM_SCRIPT, [], [guest, account, 130000]);
  assert.equal(result.ok, true); assert.equal(await redis.zscore(`queue:topic:${topic}`, guest), null);
});
