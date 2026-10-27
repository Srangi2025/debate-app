import type { Redis } from "@upstash/redis";
import { historyStore, type ArchivedMatch, type HistoryStore } from "./history-store.ts";
import { resultPayload } from "./result-payload.ts";
import type { TranscriptSegment } from "./transcript.ts";

export const HISTORY_QUEUE = "history:pending";
type Store = Pick<Redis, "get" | "hget" | "lrange" | "zrange" | "zadd" | "zrem">;

export async function archiveMatch(redis: Store, id: string, archive: HistoryStore = historyStore()) {
  const [match, result, segments] = await Promise.all([
    redis.get<ArchivedMatch["match"]>(`match:${id}`),
    redis.get<Record<string, unknown>>(`result:${id}`),
    redis.lrange<TranscriptSegment>(`match:${id}:transcript`, 0, -1),
  ]);
  if (!match || !result || match.status !== "ended" || result.status !== "finished") throw new Error("Completed debate is unavailable for archival");
  const [a, b] = await Promise.all([
    redis.hget<{ transcript: string }>(`match:${id}:submissions`, match.player1.userId),
    redis.hget<{ transcript: string }>(`match:${id}:submissions`, match.player2.userId),
  ]);
  if (!a?.transcript || !b?.transcript) throw new Error("Frozen submissions are unavailable for archival");
  archive.save({ match, result: resultPayload(result), segments, submissions: { A: a.transcript, B: b.transcript } });
}

export async function processNextArchive(redis: Store, options: { queueKey?: string; now?: () => number; archive?: HistoryStore } = {}) {
  const queue = options.queueKey ?? HISTORY_QUEUE;
  const now = options.now ?? Date.now;
  const ids = await redis.zrange<string[]>(queue, 0, now(), { byScore: true, offset: 0, count: 1 });
  const id = ids[0];
  if (!id) return false;
  try {
    // SQLite's transaction and unique ID make retries/concurrent workers idempotent.
    await archiveMatch(redis, id, options.archive);
    await redis.zrem(queue, id);
  } catch {
    await redis.zadd(queue, { score: now() + 5000, member: id });
    console.error("[history-worker] Archive unavailable; preserving the completed debate for retry.");
  }
  return true;
}
