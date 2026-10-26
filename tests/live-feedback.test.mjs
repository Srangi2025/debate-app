import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { before, after, test } from "node:test";
import IORedis from "ioredis";
import { Redis } from "@upstash/redis";
import { APPEND_TRANSCRIPT_SCRIPT } from "../lib/transcript.ts";
import { processNextLiveFeedback } from "../lib/live-feedback-worker.ts";
import { CLAIM_LIVE_SCRIPT, PUBLISH_LIVE_SCRIPT, LIVE_LEASE_MS, validLiveSnapshot } from "../lib/live-feedback.ts";

const tcp = new IORedis(process.env.REDIS_TEST_URL || "redis://127.0.0.1:6379", { lazyConnect: true, maxRetriesPerRequest: 1, retryStrategy: () => null });
tcp.on("error", () => {});
const redis = new Redis({ async request({ body: [command, ...args] }) { return { result: await tcp.call(command, ...args) }; } });
before(() => tcp.connect()); after(() => tcp.quit());
const feedback = { reasoning: "Give a clear causal explanation.", evidence: "Support claims with sources.", rebuttals: "Address the opposing argument.", relevance: "Stay on the motion." };
const analysis = () => ({ summary: "Provisional coaching.", feedback: { A: feedback, B: feedback }, claims: [], rebuttals: [], version: "test", provider: "Wikipedia summaries", model: "test" });

async function fixture(t) {
  const id = `test-live-${randomUUID()}`; const prefix = `match:${id}`;
  const queueKey = `${id}:queue`; const clock = { now: Date.now() };
  const keys = [prefix, `${prefix}:submissions`, `${prefix}:transcript`, `${prefix}:transcript-ids`, `${prefix}:transcript-lengths`, queueKey, `${prefix}:feedback-state`];
  t.after(() => redis.del(...keys, `${prefix}:live-feedback`, `${prefix}:feedback-lock`, `result:${id}`));
  await redis.set(prefix, { id, status: "active", topics: ["ai-harm"], player1: { userId: "a", username: "A" }, player2: { userId: "b", username: "B" } });
  const options = { queueKey, now: () => clock.now, analyze: async () => analysis() };
  return {
    id, prefix, keys, clock, options,
    append: (user = "a", text = "A saved contribution.", segment = randomUUID()) => redis.eval(APPEND_TRANSCRIPT_SCRIPT, keys, [user, segment, text, "text", clock.now, text.length]),
    state: () => redis.get(`${prefix}:feedback-state`), snapshot: () => redis.get(`${prefix}:live-feedback`),
  };
}

test("multiple transcript segments coalesce into one periodically scheduled analysis", async (t) => {
  const f = await fixture(t); const initial = f.clock.now;
  await f.append(); f.clock.now += 1000; await f.append("b"); f.clock.now += 1000; await f.append();
  assert.equal(await redis.zcard(f.options.queueKey), 1);
  assert.equal(Number(await redis.zscore(f.options.queueKey, f.id)), initial + 4000);
  assert.equal(await processNextLiveFeedback(redis, f.options), false);
  f.clock.now = initial + 4000;
  assert.equal(await processNextLiveFeedback(redis, f.options), true);
  assert.equal((await f.snapshot()).revision, 3);
  assert.equal((await f.state()).status, "ready");
  assert.equal(await redis.zcard(f.options.queueKey), 0);
});

test("concurrent workers cannot duplicate work and new speech schedules another update", async (t) => {
  const f = await fixture(t); await f.append(); f.clock.now += 4000;
  let entered; let release;
  const started = new Promise(resolve => { entered = resolve; });
  const gate = new Promise(resolve => { release = resolve; });
  const running = processNextLiveFeedback(redis, { ...f.options, analyze: async () => { entered(); await gate; return analysis(); } });
  await started;
  assert.equal(await processNextLiveFeedback(redis, f.options), false);
  await f.append("b", "New speech while analysis runs.");
  release(); await running;
  assert.equal((await f.snapshot()).revision, 1);
  assert.equal((await f.state()).status, "queued");
  assert.equal(Number(await redis.zscore(f.options.queueKey, f.id)), f.clock.now + 25000);
  f.clock.now += 25000; await processNextLiveFeedback(redis, f.options);
  assert.equal((await f.snapshot()).revision, 2);
});

test("AI failures preserve the last snapshot and transcript while scheduling a retry", async (t) => {
  const f = await fixture(t); await f.append(); f.clock.now += 4000;
  await processNextLiveFeedback(redis, f.options); const saved = await f.snapshot();
  await f.append("b"); f.clock.now += 25000;
  await processNextLiveFeedback(redis, { ...f.options, analyze: async () => { throw new Error("provider down"); } });
  assert.equal((await f.state()).status, "retrying"); assert.deepEqual(await f.snapshot(), saved);
  assert.equal(await redis.llen(f.keys[2]), 2);
  f.clock.now += 30000; await processNextLiveFeedback(redis, f.options);
  assert.equal((await f.snapshot()).revision, 2);
});

test("closed rooms discard in-flight feedback without touching the final result", async (t) => {
  const f = await fixture(t); await f.append(); f.clock.now += 4000;
  await processNextLiveFeedback(redis, { ...f.options, analyze: async () => {
    const match = await redis.get(f.prefix); await redis.set(f.prefix, { ...match, status: "ended" });
    await redis.set(`result:${f.id}`, { status: "finished", winner: "original" }); return analysis();
  } });
  assert.equal((await f.state()).status, "closed"); assert.equal(await f.snapshot(), null);
  assert.deepEqual(await redis.get(`result:${f.id}`), { status: "finished", winner: "original" });
});

test("expired feedback leases recover and stale owners cannot publish", async (t) => {
  const f = await fixture(t); await f.append(); f.clock.now += 4000;
  await redis.eval(CLAIM_LIVE_SCRIPT, [f.options.queueKey], [f.clock.now, "old-token", LIVE_LEASE_MS]);
  await redis.del(`${f.prefix}:feedback-lock`); f.clock.now += LIVE_LEASE_MS;
  await processNextLiveFeedback(redis, f.options); const saved = await f.snapshot();
  assert.equal(await redis.eval(PUBLISH_LIVE_SCRIPT, [f.options.queueKey, f.keys[6], `${f.prefix}:live-feedback`, `${f.prefix}:feedback-lock`, f.prefix, f.keys[2]], [f.id, "old-token", f.clock.now, JSON.stringify({ ...analysis(), revision: 999 })]), 0);
  assert.deepEqual(await f.snapshot(), saved);
});

test("unattributed claims are dropped and unsupported citation URLs are rejected", async (t) => {
  const f = await fixture(t); await f.append("a", "Earth has two moons.", "spoken-a"); f.clock.now += 4000;
  const claim = { id: "claim", segmentId: "spoken-a", userId: "b", side: "B", quote: "Earth has two moons.", statement: "Earth has two moons.", kind: "fact", verdict: "unverified", reason: "No evidence", checkedAt: "now", evidence: [] };
  await processNextLiveFeedback(redis, { ...f.options, analyze: async () => ({ ...analysis(), claims: [claim] }) });
  assert.equal((await f.snapshot()).claims.length, 0);
  assert.equal(validLiveSnapshot({ ...analysis(), claims: [{ ...claim, verdict: "supported" }] }), false);
  assert.equal(validLiveSnapshot({ ...analysis(), claims: [{ ...claim, verdict: "supported", evidence: [{ title: "Fake", url: "http://127.0.0.1/private", quote: "fake", retrievedAt: "now" }] }] }), false);
});
