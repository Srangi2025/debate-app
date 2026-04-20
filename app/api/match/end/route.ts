import { NextRequest, NextResponse } from "next/server";
import { redis } from "@/lib/redis";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const matchId = String(body.matchId || "").trim();
    const winnerUserId = String(body.winnerUserId || "").trim();

    if (!matchId) {
      return NextResponse.json({ error: "Missing matchId" }, { status: 400 });
    }

    const match = await redis.get<any>(`match:${matchId}`);
    if (!match) {
      return NextResponse.json({ error: "Match not found" }, { status: 404 });
    }

    const player1 = match.player1 ?? null;
    const player2 = match.player2 ?? null;

    let winner = null;
    let loser = null;

    if (winnerUserId && player1?.userId === winnerUserId) {
      winner = player1;
      loser = player2;
    } else if (winnerUserId && player2?.userId === winnerUserId) {
      winner = player2;
      loser = player1;
    }

    const endedAt = Date.now();

    const result = {
      matchId,
      topics: Array.isArray(match.topics) ? match.topics : [],
      endedAt,
      winner,
      loser,
      player1,
      player2,
      status: "finished",
    };

    await redis.set(`result:${matchId}`, result);

    await redis.set(`match:${matchId}`, {
      ...match,
      status: "ended",
      endedAt,
    });

    if (player1?.userId) {
      await redis.del(`user:${player1.userId}:match`);
    }

    if (player2?.userId) {
      await redis.del(`user:${player2.userId}:match`);
    }

    return NextResponse.json({
      ok: true,
      resultUrl: `/result/${matchId}`,
    });
  } catch (error) {
    console.error("match/end error", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}