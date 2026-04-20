import { NextRequest, NextResponse } from "next/server";
import { redis } from "@/lib/redis";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const matchId = String(body.matchId || "").trim();

    if (!matchId) {
      return NextResponse.json({ error: "Missing matchId" }, { status: 400 });
    }

    const match = await redis.get<any>(`match:${matchId}`);
    if (!match) {
      return NextResponse.json({ error: "Match not found" }, { status: 404 });
    }

    match.status = "ended";
    match.endedAt = Date.now();

    await redis.set(`match:${matchId}`, match);

    if (match.player1?.userId) await redis.del(`user:${match.player1.userId}:match`);
    if (match.player2?.userId) await redis.del(`user:${match.player2.userId}:match`);

    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("match/end error", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}