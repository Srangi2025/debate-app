import nextEnv from "@next/env";

nextEnv.loadEnvConfig(process.cwd(), process.env.NODE_ENV !== "production");
const { redis } = await import("../lib/redis.ts");
const { processNextJudgment } = await import("../lib/judging-worker.ts");
const { processNextLiveFeedback } = await import("../lib/live-feedback-worker.ts");
const { processNextArchive } = await import("../lib/history-worker.ts");
const { JUDGING_HEARTBEAT } = await import("../lib/judging-jobs.ts");
let stopping = false;
process.on("SIGINT", () => { stopping = true; });
process.on("SIGTERM", () => { stopping = true; });

const heartbeat = () => redis.set(JUDGING_HEARTBEAT, Date.now(), { ex: 15 })
  .catch(() => {});
const timer = setInterval(heartbeat, 5000);
await heartbeat();
console.log("[judge-worker] Ready. Processing saved debates one at a time.");
console.log("[judge-worker] Final outcomes have priority; live feedback runs between final jobs.");
try {
  do {
    try {
      const processed = await processNextJudgment(redis);
      const archived = await processNextArchive(redis);
      if (process.argv.includes("--once")) break;
      // Final outcomes take priority; live snapshots are lower-priority work.
      if (!processed && !archived && !await processNextLiveFeedback(redis)) await new Promise(resolve => setTimeout(resolve, 500));
    } catch (error) {
      console.error("[judge-worker] Store unavailable; retrying:", error instanceof Error ? error.message : "Unknown error");
      if (process.argv.includes("--once")) { process.exitCode = 1; break; }
      await new Promise(resolve => setTimeout(resolve, 2000));
    }
  } while (!stopping);
} finally {
  clearInterval(timer);
  // The Redis TCP client otherwise keeps an idle worker process alive.
  process.exit(process.exitCode ?? 0);
}
