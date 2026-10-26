import { randomUUID } from "node:crypto";
import type { Redis } from "@upstash/redis";
import { CLAIM_LIVE_SCRIPT, LIVE_FEEDBACK_QUEUE, LIVE_LEASE_MS, PUBLISH_LIVE_SCRIPT, validLiveSnapshot, type LiveSnapshot } from "./live-feedback.ts";
import type { TranscriptSegment } from "./transcript.ts";
import { TOPICS } from "./topics.ts";

type Store = Pick<Redis, "eval" | "get" | "lrange">;
type Input = { topic: string; segments: Pick<TranscriptSegment, "id" | "userId" | "side" | "text">[] };
type Options = { queueKey?: string; now?: () => number; analyze?: (input: Input) => Promise<unknown> };

async function analyze(input: Input) {
  const service = process.env.AI_JUDGE_URL;
  if (!service) throw new Error("AI_JUDGE_URL is not configured");
  const response = await fetch(`${service.replace(/\/+$/, "")}/live-feedback`, {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(input),
    signal: AbortSignal.timeout(80000),
  });
  if (!response.ok) throw new Error(`Live feedback service returned HTTP ${response.status}`);
  return response.json();
}

export async function processNextLiveFeedback(redis: Store, options: Options = {}) {
  const queue = options.queueKey ?? LIVE_FEEDBACK_QUEUE;
  const now = options.now ?? Date.now;
  const token = randomUUID();
  const job = await redis.eval<unknown[], { matchId: string; revision: number } | null>(CLAIM_LIVE_SCRIPT, [queue], [now(), token, LIVE_LEASE_MS]);
  if (!job) return false;
  const prefix = `match:${job.matchId}`;
  let snapshot = "";
  try {
    const [match, all, previous] = await Promise.all([
      redis.get<{ topics: string[] }>(prefix), redis.lrange<TranscriptSegment>(`${prefix}:transcript`, 0, job.revision - 1),
      redis.get<LiveSnapshot>(`${prefix}:live-feedback`),
    ]);
    if (!match) throw new Error("Match not found");
    // Bound the model context while retaining earlier tracked claims separately.
    let characters = 0;
    const segments: TranscriptSegment[] = [];
    for (const segment of all.slice(-40).reverse()) {
      if (characters + segment.text.length > 8000) break;
      characters += segment.text.length; segments.unshift(segment);
    }
    const input: Input = {
      topic: match.topics.map(id => TOPICS.find(topic => topic.id === id)?.title ?? id).join(", ") || "General debate",
      segments: segments.map(({ id, userId, side, text }) => ({ id, userId, side, text })),
    };
    const response = await (options.analyze ?? analyze)(input);
    if (!validLiveSnapshot(response)) throw new Error("Invalid live feedback response");
    const byId = new Map(segments.map(segment => [segment.id, segment]));
    const claims = response.claims.filter(claim => {
      const original = byId.get(claim.segmentId);
      return original && original.userId === claim.userId && original.side === claim.side && original.text.replace(/\s+/g, " ").includes(claim.quote.replace(/\s+/g, " "));
    });
    const merged = new Map((previous?.claims ?? []).map(claim => [claim.id, claim]));
    for (const claim of claims) merged.set(claim.id, claim);
    const rebuttals = response.rebuttals.filter(item => byId.get(item.fromSegmentId)?.side === item.fromSide && byId.get(item.targetSegmentId)?.side === item.targetSide);
    snapshot = JSON.stringify({
      summary: response.summary, feedback: response.feedback, claims: Array.from(merged.values()).slice(-24),
      rebuttals, version: response.version, provider: "Wikipedia summaries", model: response.model,
      revision: job.revision, updatedAt: now(),
    });
  } catch (error) {
    console.error(`[live-feedback] ${job.matchId}:`, error instanceof Error ? error.message : "Analysis failed");
  }
  await redis.eval(PUBLISH_LIVE_SCRIPT,
    [queue, `${prefix}:feedback-state`, `${prefix}:live-feedback`, `${prefix}:feedback-lock`, prefix, `${prefix}:transcript`],
    [job.matchId, token, now(), snapshot]
  );
  return true;
}
