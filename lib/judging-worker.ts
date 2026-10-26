import { randomUUID } from "node:crypto";
import type { Redis } from "@upstash/redis";
import { evaluateDebate, isAIJudgeResult, type AIJudgeResult } from "./judge-client.ts";
import { FINALIZE_JUDGMENT_SCRIPT } from "./judging-finalization-script.ts";
import { TOPICS } from "./topics.ts";
import {
  CLAIM_JUDGING_SCRIPT, SETTLE_JUDGING_SCRIPT, JOB_LEASE_MS,
  JUDGING_JOB_PREFIX, JUDGING_QUEUE, MAX_JUDGING_ATTEMPTS, type JudgingJob,
} from "./judging-jobs.ts";

type Store = Pick<Redis, "eval" | "get" | "hget">;
type Match = {
  status: string;
  topics: string[];
  player1: { userId: string };
  player2: { userId: string };
};
type Submission = { userId: string; transcript: string };
type Options = {
  queueKey?: string;
  jobPrefix?: string;
  now?: () => number;
  evaluate?: (topic: string, a: string, b: string) => Promise<AIJudgeResult>;
};

// One claimed job per call; multiple worker processes share Redis ownership.
export async function processNextJudgment(redis: Store, options: Options = {}) {
  const queueKey = options.queueKey ?? JUDGING_QUEUE;
  const jobPrefix = options.jobPrefix ?? JUDGING_JOB_PREFIX;
  const now = options.now ?? Date.now;
  const token = randomUUID();
  const job = await redis.eval<unknown[], JudgingJob | null>(
    CLAIM_JUDGING_SCRIPT, [queueKey],
    [now(), token, JOB_LEASE_MS, jobPrefix, MAX_JUDGING_ATTEMPTS]
  );
  if (!job) return false;

  let outcome = "failed";
  try {
    const [match, result] = await Promise.all([
      redis.get<Match>(`match:${job.matchId}`),
      redis.get<{ status: string }>(`result:${job.matchId}`),
    ]);
    if (!match || !result) throw new Error("Saved match or result is missing");
    if (match.status === "ended" && result.status === "finished") {
      outcome = "completed";
    } else {
      if (!["pending_judgment", "judging"].includes(match.status)) throw new Error("Match is not awaiting judgment");
      const [a, b] = await Promise.all([
        redis.hget<Submission>(`match:${job.matchId}:submissions`, match.player1.userId),
        redis.hget<Submission>(`match:${job.matchId}:submissions`, match.player2.userId),
      ]);
      if (!a || !b || a.userId !== match.player1.userId || b.userId !== match.player2.userId ||
          !a.transcript?.trim() || !b.transcript?.trim()) throw new Error("Valid submissions from both participants are required");
      const topic = match.topics.map(id => TOPICS.find(topic => topic.id === id)?.title ?? id).join(", ") || "General debate";
      const judgment = await (options.evaluate ?? evaluateDebate)(topic, a.transcript, b.transcript);
      if (!isAIJudgeResult(judgment)) throw new Error("Invalid response from AI judge");
      const finalized = await redis.eval<unknown[], { ok: boolean; reason?: string }>(
        FINALIZE_JUDGMENT_SCRIPT,
        [`match:${job.matchId}`, `result:${job.matchId}`, `match:${job.matchId}:judging-lock`],
        [token, JSON.stringify(judgment), now()]
      );
      if (!finalized.ok) throw new Error(`Judgment was not saved: ${finalized.reason}`);
      outcome = "completed";
    }
  } catch (error) {
    console.error(`[judge-worker] ${job.matchId}, attempt ${job.attempts}:`, error instanceof Error ? error.message : "Judging failed");
  }

  // If the process dies before this acknowledgement, the leased job remains
  // scheduled. Finalization and acknowledgements both check the owner token.
  await redis.eval(
    SETTLE_JUDGING_SCRIPT,
    [queueKey, `${jobPrefix}${job.matchId}`, `match:${job.matchId}:judging-lock`],
    [job.matchId, token, now(), outcome, MAX_JUDGING_ATTEMPTS]
  );
  return true;
}
