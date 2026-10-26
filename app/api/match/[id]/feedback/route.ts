import { NextResponse } from "next/server";
import { authenticate, authorizeMatch } from "@/lib/server-auth";
import { redis } from "@/lib/redis";
import type { LiveSnapshot, LiveState } from "@/lib/live-feedback";

export async function GET(req: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const auth = await authenticate(req);
    if (auth.response) return auth.response;
    const { id } = await context.params;
    const access = await authorizeMatch(id, auth.userId);
    if (access.response) return access.response;
    const [snapshot, state] = await Promise.all([
      redis.get<LiveSnapshot>(`match:${id}:live-feedback`),
      redis.get<LiveState>(`match:${id}:feedback-state`),
    ]);
    return NextResponse.json({ snapshot, state: state ? {
      status: state.status, requestedRevision: state.requestedRevision, analyzedRevision: state.analyzedRevision,
      updatedAt: state.updatedAt, error: state.error,
    } : null });
  } catch (error) {
    console.error("live feedback read error", error);
    return NextResponse.json({ error: "Live feedback is temporarily unavailable. Your transcript is still saved." }, { status: 503 });
  }
}
