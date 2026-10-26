import { NextResponse } from "next/server";
import { authenticate, authorizeMatch } from "@/lib/server-auth";
import { MATCH_LIFECYCLE_SCRIPT } from "@/lib/match-lifecycle";
import { redis } from "@/lib/redis";

export async function POST(req: Request) {
  try {
    const auth = await authenticate(req);
    if (auth.response) return auth.response;
    const body = await req.json().catch(() => null);
    const id = typeof body?.matchId === "string" ? body.matchId.trim() : "";
    if (!id) return NextResponse.json({ error: "A match ID is required" }, { status: 400 });
    const access = await authorizeMatch(id, auth.userId);
    if (access.response) return access.response;
    const outcome = await redis.eval<unknown[], { error?: string; statusCode?: number }>(
      MATCH_LIFECYCLE_SCRIPT,
      [`match:${id}`, `user:${access.match.player1?.userId}:match`, `user:${access.match.player2?.userId}:match`],
      [auth.userId, Date.now(), "leave"]
    );
    return NextResponse.json(outcome, { status: outcome.statusCode ?? 200 });
  } catch (error) {
    console.error("match/leave error", error);
    return NextResponse.json({ error: "Unable to leave the match. Please retry." }, { status: 500 });
  }
}
