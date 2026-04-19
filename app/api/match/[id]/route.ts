import { NextResponse } from "next/server";
import { redis } from "@/lib/redis";

export async function GET(
  _req: Request,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await context.params;
    const matchId = id;

    if (!matchId) {
      return NextResponse.json({ error: "Missing match id" }, { status: 400 });
    }

    const matchData = await redis.hgetall(`match:${matchId}`);

    if (!matchData || !matchData.matchId) {
      return NextResponse.json({ error: "Match not found" }, { status: 404 });
    }

    const player1Id = matchData.player1Id;
    const player2Id = matchData.player2Id;

    const rating1 = Number(await redis.get(`rating:${player1Id}`)) || 1000;
    const rating2 = Number(await redis.get(`rating:${player2Id}`)) || 1000;

    return NextResponse.json({
      matchId: matchData.matchId,
      player1Id: matchData.player1Id,
      player2Id: matchData.player2Id,
      topicId: matchData.topicId,
      player1Side: matchData.player1Side,
      player2Side: matchData.player2Side,
      status: matchData.status,
      createdAt: matchData.createdAt,
      winnerId: matchData.winnerId || null,
      ratingChange1: matchData.ratingChange1 || "0",
      ratingChange2: matchData.ratingChange2 || "0",
      rating1,
      rating2,
    });
  } catch (error) {
    console.error("match/[id] error", error);
    return NextResponse.json(
      { error: "Failed to fetch match" },
      { status: 500 }
    );
  }
}