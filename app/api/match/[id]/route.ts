import { NextResponse } from "next/server";
import { redis } from "@/lib/redis";

type MatchRecord = {
  matchId?: string;
  player1Id?: string;
  player2Id?: string;
  player1Username?: string;
  player2Username?: string;
  topicId?: string;
  player1Side?: string;
  player2Side?: string;
  status?: string;
  createdAt?: string;
  winnerId?: string;
  ratingChange1?: string;
  ratingChange2?: string;
};

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

    const rawMatch = await redis.hgetall(`match:${matchId}`);
    const matchData = rawMatch as MatchRecord | null;

    if (!matchData || !matchData.matchId) {
      return NextResponse.json({ error: "Match not found" }, { status: 404 });
    }

    const player1Id = matchData.player1Id || "";
    const player2Id = matchData.player2Id || "";

    const rating1 = Number(await redis.get(`rating:${player1Id}`)) || 1000;
    const rating2 = Number(await redis.get(`rating:${player2Id}`)) || 1000;

    return NextResponse.json({
      matchId: matchData.matchId,
      player1Id,
      player2Id,
      player1Username: matchData.player1Username || player1Id,
      player2Username: matchData.player2Username || player2Id,
      topicId: matchData.topicId || "",
      player1Side: matchData.player1Side || "",
      player2Side: matchData.player2Side || "",
      status: matchData.status || "live",
      createdAt: matchData.createdAt || "",
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