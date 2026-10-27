import { authenticate, authorizeMatch } from "@/lib/server-auth";
import { NextRequest, NextResponse } from "next/server";
import { redis } from "@/lib/redis";
import { JUDGING_JOB_PREFIX, JUDGING_HEARTBEAT, type JudgingJob } from "@/lib/judging-jobs";
import { resultPayload } from "@/lib/result-payload";
import { historyStore } from "@/lib/history-store";

export async function GET(
  req: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const auth = await authenticate(req);
    if (auth.response) return auth.response;
    const userId = auth.userId;

    const { id } = await context.params;
    const archived = historyStore().get(userId, id);
    if (archived) return NextResponse.json(archived.result);

    const access = await authorizeMatch(id, userId);
    if (access.response) return access.response;

    const result = await redis.get<Record<string, unknown>>(`result:${id}`);

    if (!result) {
      return NextResponse.json({ error: "Result not found" }, { status: 404 });
    }

    if (result.status === "pending_judgment" || result.status === "judging") {
      const [job, worker] = await Promise.all([
        redis.get<JudgingJob>(`${JUDGING_JOB_PREFIX}${id}`),
        redis.get(JUDGING_HEARTBEAT),
      ]);
      return NextResponse.json({
        ...result,
        judgingJob: job ? {
          status: job.status, attempts: job.attempts, queuedAt: job.queuedAt,
          nextAttemptAt: job.nextAttemptAt, error: job.error,
        } : null,
        workerOnline: !!worker,
      });
    }
    return NextResponse.json(resultPayload(result));
  } catch (error) {
    console.error("result/[id] error", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
