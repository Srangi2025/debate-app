
import "server-only";
import { randomUUID } from "node:crypto";
import { redis } from "@/lib/redis";

const LOCK_TTL_SECONDS = 240;

export async function acquireJudgingLock(
  matchId: string
): Promise<string | null> {
  const token = randomUUID();

  const acquired = await redis.set(
    `match:${matchId}:judging-lock`,
    token,
    {
      nx: true,
      ex: LOCK_TTL_SECONDS,
    }
  );

  return acquired === "OK" ? token : null;
}

// Only the process holding the lock can release it.
const RELEASE_LOCK_SCRIPT = `
if redis.call('GET', KEYS[1]) == ARGV[1] then
  return redis.call('DEL', KEYS[1])
end
return 0
`;

export async function releaseJudgingLock(
  matchId: string,
  token: string
): Promise<void> {
  await redis.eval(
    RELEASE_LOCK_SCRIPT,
    [`match:${matchId}:judging-lock`],
    [token]
  );
}
