import { NextRequest, NextResponse } from "next/server";
import { authenticate, authorizeMatch } from "@/lib/server-auth";
import { redis } from "@/lib/redis";
import { ENQUEUE_JUDGING_SCRIPT, JUDGING_JOB_PREFIX, JUDGING_QUEUE, type JudgingJob } from "@/lib/judging-jobs";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  try {
    const auth = await authenticate(req);
    if (auth.response) return auth.response;
    const body: unknown = await req.json().catch(() => null);
    const matchId = body && typeof body === "object" && "matchId" in body && typeof body.matchId === "string"
      ? body.matchId.trim() : "";
    if (!matchId) return NextResponse.json({ error: "A match ID is required" }, { status: 400 });
    const access = await authorizeMatch(matchId, auth.userId);
    if (access.response) return access.response;
    const outcome = await redis.eval<unknown[], JudgingJob & { error?: string; statusCode?: number }>(
      ENQUEUE_JUDGING_SCRIPT,
      [JUDGING_QUEUE, `${JUDGING_JOB_PREFIX}${matchId}`, `match:${matchId}`],
      [matchId, Date.now()]
    );
    if (outcome.statusCode) return NextResponse.json({ error: outcome.error }, { status: outcome.statusCode });
    return NextResponse.json({
      status: outcome.status,
      resultUrl: `/result/${matchId}`,
    }, { status: outcome.status === "completed" ? 200 : 202 });
  } catch (error) {
    console.error("match/judge error", error);
    return NextResponse.json({ error: "Unable to queue judging. Please retry." }, { status: 500 });
  }
}
