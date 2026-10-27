import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { before, after, test } from "node:test";
import IORedis from "ioredis";
import { Redis } from "@upstash/redis";
import {
  ENQUEUE_JUDGING_SCRIPT, CLAIM_JUDGING_SCRIPT, SETTLE_JUDGING_SCRIPT, RENEW_JUDGING_SCRIPT,
  JOB_LEASE_MS, MAX_JUDGING_ATTEMPTS,
} from "../lib/judging-jobs.ts";
import { FINALIZE_JUDGMENT_SCRIPT } from "../lib/judging-finalization-script.ts";
import { processNextJudgment } from "../lib/judging-worker.ts";
import { isAIJudgeResult } from "../lib/judge-client.ts";
import { resultPayload } from "../lib/result-payload.ts";

const tcp = new IORedis(process.env.REDIS_TEST_URL || "redis://127.0.0.1:6379", {
  lazyConnect: true, maxRetriesPerRequest: 1, retryStrategy: () => null,
});
tcp.on("error", () => {});
const redis = new Redis({
  async request({ body: [command, ...args] }) { return { result: await tcp.call(command, ...args) }; },
});
before(() => tcp.connect());
after(() => tcp.quit());

const judgment = {
  winner: "A", reasoning: "A provided a clearer chain of reasoning grounded in its submitted argument.",
  scores: { A: { reasoning: 8, evidence: 6, rebuttals: 7, relevance: 9 }, B: { reasoning: 6, evidence: 5, rebuttals: 5, relevance: 7 } },
  weighted_scores: { A: 7.45, B: 5.7 },
  strengths: { A: ["Clear causal reasoning"], B: ["Relevant concern"] },
  improvements: { A: ["Cite evidence"], B: ["Address the opposing claim"] },
  judge_version: "test-judge", rubric_version: "debate-rubric-v1",
};

async function fixture(t, count = 1) {
  const prefix = `test-judging:${randomUUID()}:`;
  const queueKey = `${prefix}schedule`;
  const jobPrefix = `${prefix}job:`;
  const clock = { now: 1000 };
  const options = { queueKey, jobPrefix, historyQueueKey: `${prefix}history`, now: () => clock.now, evaluate: async () => structuredClone(judgment) };
  const ids = [];
  t.after(async () => {
    const keys = [queueKey, options.historyQueueKey, ...ids.flatMap(id => [`match:${id}`, `result:${id}`, `match:${id}:submissions`, `match:${id}:judging-lock`, `${jobPrefix}${id}`])];
    await redis.del(...keys);
  });
  const enqueue = (id = ids[0]) => redis.eval(ENQUEUE_JUDGING_SCRIPT,
    [queueKey, `${jobPrefix}${id}`, `match:${id}`], [id, clock.now]);
  for (let index = 0; index < count; index++) {
    const id = `test-judge-${randomUUID()}`;
    ids.push(id);
    const match = {
      id, status: "pending_judgment", topics: ["ai-harm"],
      player1: { userId: `${id}-a`, username: "A" }, player2: { userId: `${id}-b`, username: "B" },
    };
    await redis.set(`match:${id}`, match);
    await redis.set(`result:${id}`, { matchId: id, status: "pending_judgment" });
    await redis.hset(`match:${id}:submissions`, {
      [match.player1.userId]: { userId: match.player1.userId, transcript: `${id}: argument A` },
      [match.player2.userId]: { userId: match.player2.userId, transcript: `${id}: argument B` },
    });
    await enqueue(id);
  }
  return {
    ids, id: ids[0], queueKey, jobPrefix, clock, options, enqueue,
    job: (id = ids[0]) => redis.get(`${jobPrefix}${id}`),
    claim: (token = "crashed-worker") => redis.eval(CLAIM_JUDGING_SCRIPT, [queueKey],
      [clock.now, token, JOB_LEASE_MS, jobPrefix, MAX_JUDGING_ATTEMPTS]),
  };
}

test("duplicate browser retries and concurrent workers execute a job once", async (t) => {
  const f = await fixture(t);
  await Promise.all(Array.from({ length: 10 }, () => f.enqueue()));
  assert.equal(await redis.zcard(f.queueKey), 1);
  let release;
  let started;
  const entered = new Promise(resolve => { started = resolve; });
  const blocked = new Promise(resolve => { release = resolve; });
  let calls = 0;
  const running = processNextJudgment(redis, { ...f.options, evaluate: async () => {
    calls++; started(); await blocked; return judgment;
  } });
  await entered;
  assert.deepEqual(await Promise.all(Array.from({ length: 10 }, () => processNextJudgment(redis, f.options))), Array(10).fill(false));
  await f.enqueue();
  assert.equal((await f.job()).status, "judging");
  release();
  await running;
  assert.equal(calls, 1);
  assert.equal((await f.job()).status, "completed");
  assert.equal(await redis.zcard(f.queueKey), 0);
  assert.equal((await redis.get(`result:${f.id}`)).winner.userId, `${f.id}-a`);
});

test("five debates complete independently with no result-page trigger", async (t) => {
  const f = await fixture(t, 5);
  const heard = new Set();
  for (let i = 0; i < 5; i++) assert.equal(await processNextJudgment(redis, {
    ...f.options, evaluate: async (topic, a, b) => {
      assert.equal(topic, "AI does more harm than good");
      const id = a.split(":")[0];
      assert.equal(b, `${id}: argument B`);
      heard.add(id);
      return judgment;
    },
  }), true);
  assert.equal(heard.size, 5);
  for (const id of f.ids) {
    assert.equal((await redis.get(`result:${id}`)).status, "finished");
    assert.equal((await f.job(id)).attempts, 1);
  }
  assert.equal(await processNextJudgment(redis, f.options), false);
});

test("an AI outage preserves evidence, backs off, and later recovers automatically", async (t) => {
  const f = await fixture(t);
  await processNextJudgment(redis, { ...f.options, evaluate: async () => { throw new Error("provider unavailable"); } });
  const job = await f.job();
  assert.equal(job.status, "retrying");
  assert.equal(job.nextAttemptAt, 6000);
  assert.equal((await redis.get(`result:${f.id}`)).status, "pending_judgment");
  assert.equal(await tcp.ttl(`match:${f.id}:submissions`), -1);
  assert.equal(await processNextJudgment(redis, f.options), false);
  await f.enqueue();
  assert.equal((await f.job()).nextAttemptAt, 6000, "Browser retries must respect backoff");
  f.clock.now = job.nextAttemptAt;
  await processNextJudgment(redis, f.options);
  assert.equal((await f.job()).status, "completed");
  assert.equal((await f.job()).attempts, 2);
});

test("exhausted retries show failure and can be restarted explicitly", async (t) => {
  const f = await fixture(t);
  for (let attempt = 1; attempt <= MAX_JUDGING_ATTEMPTS; attempt++) {
    await processNextJudgment(redis, { ...f.options, evaluate: async () => { throw new Error("private provider detail"); } });
    const job = await f.job();
    assert.equal(job.attempts, attempt);
    assert.doesNotMatch(job.error, /private provider detail/);
    f.clock.now = job.nextAttemptAt ?? f.clock.now;
  }
  assert.equal((await f.job()).status, "failed");
  assert.equal(await redis.zcard(f.queueKey), 0);
  assert.equal((await f.enqueue()).status, "queued");
  await processNextJudgment(redis, f.options);
  assert.equal((await f.job()).status, "completed");
});

test("a new worker reclaims an expired job and rejects stale acknowledgements", async (t) => {
  const f = await fixture(t);
  const old = await f.claim();
  assert.equal(old.status, "judging");
  assert.equal(await processNextJudgment(redis, f.options), false);
  // Simulate Redis's real lock expiry while advancing the injected schedule clock.
  await redis.del(`match:${f.id}:judging-lock`);
  f.clock.now += JOB_LEASE_MS;
  await processNextJudgment(redis, f.options);
  const saved = await f.job();
  assert.equal(saved.status, "completed");
  assert.equal(saved.attempts, 2);
  assert.equal(await redis.eval(SETTLE_JUDGING_SCRIPT,
    [f.queueKey, `${f.jobPrefix}${f.id}`, `match:${f.id}:judging-lock`],
    [f.id, "crashed-worker", f.clock.now, "failed", MAX_JUDGING_ATTEMPTS]), 0);
  assert.deepEqual(await f.job(), saved);
});

test("crashing after finalization does not evaluate or finalize the match again", async (t) => {
  const f = await fixture(t);
  await f.claim();
  await redis.eval(FINALIZE_JUDGMENT_SCRIPT,
    [`match:${f.id}`, `result:${f.id}`, `match:${f.id}:judging-lock`],
    ["crashed-worker", JSON.stringify(judgment), f.clock.now]);
  const result = await redis.get(`result:${f.id}`);
  f.clock.now += JOB_LEASE_MS;
  await processNextJudgment(redis, { ...f.options, evaluate: async () => { assert.fail("Already saved judgments must not run again"); } });
  assert.equal((await f.job()).status, "completed");
  assert.deepEqual(await redis.get(`result:${f.id}`), result);
});

test("invalid model output is rejected without overwriting the pending result", async (t) => {
  const f = await fixture(t);
  await processNextJudgment(redis, { ...f.options, evaluate: async () => ({ winner: "A", reasoning: "Incomplete" }) });
  assert.equal((await f.job()).status, "retrying");
  assert.equal((await redis.get(`result:${f.id}`)).status, "pending_judgment");
  assert.equal(isAIJudgeResult(judgment), true);
  assert.equal(isAIJudgeResult({ ...judgment, weighted_scores: { A: "8", B: 5 } }), false);
  assert.equal(isAIJudgeResult({ ...judgment, scores: { A: { reasoning: 99 }, B: {} } }), false);
  assert.equal(isAIJudgeResult({ ...judgment, winner: "B" }), false);
  assert.equal(isAIJudgeResult({ ...judgment, weighted_scores: { A: 9, B: 5.7 } }), false);
});

test("long evaluations renew their schedule and only the current owner can extend a lease", async (t) => {
  const f = await fixture(t);
  await f.claim("owner");
  f.clock.now += JOB_LEASE_MS - 1000;
  const keys = [f.queueKey, `${f.jobPrefix}${f.id}`, `match:${f.id}:judging-lock`];
  const renew = token => redis.eval(RENEW_JUDGING_SCRIPT, keys, [f.id, token, f.clock.now, JOB_LEASE_MS]);
  assert.equal(await renew("owner"), 1);
  assert.equal((await f.job()).nextAttemptAt, f.clock.now + JOB_LEASE_MS);
  assert.ok(await tcp.pttl(keys[2]) > JOB_LEASE_MS - 1000);
  const saved = await f.job();
  assert.equal(await renew("stale"), 0);
  assert.deepEqual(await f.job(), saved);
  f.clock.now += 2000;
  assert.equal(await processNextJudgment(redis, f.options), false, "Renewed work must not be reclaimed at its original deadline");
});

test("a running worker aborts after losing ownership without touching the new owner's job", { timeout: 5000 }, async (t) => {
  const f = await fixture(t);
  let entered;
  const started = new Promise(resolve => { entered = resolve; });
  const running = processNextJudgment(redis, { ...f.options, renewIntervalMs: 10, evaluate: async (_topic, _a, _b, signal) => {
    entered();
    await new Promise((resolve, reject) => signal.addEventListener("abort", () => reject(signal.reason), { once: true }));
    return judgment;
  } });
  await started;
  const replacement = { ...await f.job(), token: "new-owner" };
  await redis.set(`${f.jobPrefix}${f.id}`, replacement);
  await redis.set(`match:${f.id}:judging-lock`, "new-owner", { px: JOB_LEASE_MS });
  await running;
  assert.deepEqual(await f.job(), replacement);
  assert.equal(await redis.get(`match:${f.id}:judging-lock`), "new-owner");
  assert.equal((await redis.get(`result:${f.id}`)).status, "pending_judgment");
});

test("final evidence and coverage survive finalization and malformed evidence is rejected", async (t) => {
  const f = await fixture(t);
  const grounded = { ...judgment,
    source_checks: [{ id: "F1", side: "A", quote: "A sourced claim.", verdict: "supported", reason: "The quoted source supports this claim.",
      evidence: [{ title: "Triangle", url: "https://en.wikipedia.org/wiki/Triangle", provider: "Wikipedia", retrievedAt: "2026-10-25T00:00:00Z", quote: "A triangle has three sides." }] }],
    evidence_used: ["F1"],
    review: { mode: "summarized", characters: { A: 20000, B: 20000 }, chunks: { A: 4, B: 4 }, context_tokens: 16384, checked_claims: 1, candidate_claims: 2, warnings: ["The final score uses summaries."] },
  };
  assert.equal(isAIJudgeResult(grounded), true);
  assert.equal(isAIJudgeResult({ ...grounded, evidence_used: ["FAKE"] }), false);
  assert.equal(isAIJudgeResult({ ...grounded, evidence_used: [] }), false);
  assert.equal(isAIJudgeResult({ ...grounded, source_checks: [{ ...grounded.source_checks[0], evidence: [] }] }), false);
  assert.equal(isAIJudgeResult({ ...grounded, review: { ...grounded.review, checked_claims: 2 } }), false);
  const injected = structuredClone(grounded);
  injected.source_checks[0].evidence[0].url = "javascript:alert(1)";
  assert.equal(isAIJudgeResult(injected), false);
  await processNextJudgment(redis, { ...f.options, evaluate: async () => grounded });
  const saved = await redis.get(`result:${f.id}`);
  assert.deepEqual(saved.sourceChecks, grounded.source_checks);
  assert.deepEqual(saved.evidenceUsed, ["F1"]);
  assert.deepEqual(saved.review, grounded.review);
});

test("finished API payloads preserve empty evidence arrays for unverified and absent claims", async (t) => {
  const f = await fixture(t, 2);
  let calls = 0;
  for (let index = 0; index < 2; index++) {
    await processNextJudgment(redis, { ...f.options, evaluate: async () => {
      const checks = calls++ === 0 ? [] : [{ id: "F1", side: "A", quote: "An unverified claim.", verdict: "unverified", reason: "No source was available.", evidence: [] }];
      return { ...judgment, source_checks: checks, evidence_used: [],
        review: { mode: "full", characters: { A: 20, B: 20 }, chunks: { A: 1, B: 1 }, context_tokens: 16384, checked_claims: checks.length, candidate_claims: checks.length, warnings: [] } };
    } });
  }
  const results = await Promise.all(f.ids.map(async id => resultPayload(await redis.get(`result:${id}`))));
  assert.deepEqual(results.map(result => result.sourceChecks.length).sort(), [0, 1]);
  for (const result of results) {
    assert.equal(result.status, "finished");
    assert.equal("judgmentJson" in result, false);
    assert.deepEqual(result.evidenceUsed, []);
    assert.deepEqual(result.review.warnings, []);
    for (const check of result.sourceChecks) assert.deepEqual(check.evidence, []);
  }
});
