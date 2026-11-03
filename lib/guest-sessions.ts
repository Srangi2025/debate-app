import type { Redis } from "@upstash/redis";
import type { DurableHistory } from "./history-store.ts";

export async function resolveGuestCredential(credential: string | undefined, history: DurableHistory, redis: Pick<Redis, "get" | "ttl">): Promise<string | null> {
  if (!credential) return null;
  const durable = await history.guest(credential);
  if (durable) return durable;
  const key = `guest-session:${credential}`;
  const [legacy, ttl] = await Promise.all([redis.get<string>(key).catch(() => null), redis.ttl(key).catch(() => 0)]);
  if (typeof legacy !== "string" || !legacy.startsWith("guest:") || ttl <= 0 || await history.participantOwner(legacy) !== legacy) return null;
  // Migrating an old cookie must not grant it a new thirty-day lifetime.
  const remembered = await history.rememberGuest(credential, legacy, Date.now() + Math.min(ttl, 30 * 86400) * 1000);
  return remembered ? await history.guest(credential) : null;
}
