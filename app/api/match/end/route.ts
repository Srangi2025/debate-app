import { NextResponse } from "next/server";
import { redis } from "@/lib/redis";

function calculateElo(ratingA: number, ratingB: number, scoreA: number) {
  const K = 32;
  const expectedA = 1 / (1 + Math.pow(10, (ratingB - ratingA) / 400));
  return Math.round(ratingA + K * (scoreA - expectedA));
}

export async function POST(req: Request) {
  try {
    const { matchId, winnerId } = await req.json();

    if (!matchId || !winnerId) {
      return NextResponse.json(
        { error: "Missing matchId or winnerId" },
        { status: 400 }
      );
    }

    const match = await redis.hgetall(`match:${matchId}`);

    if (!match || !match.matchId) {
      return NextResponse.json({ error: "Match not found" }, { status: 404 });
    }

    if (match.status === "completed") {
      return NextResponse.json(
        {
          ok: false,
          error: "Match already completed",
          winnerId: match.winnerId,
        },
        { status: 400 }
      );
    }

    const p1 = match.player1Id as string;
    const p2 = match.player2Id as string;

    const rating1 = Number(await redis.get(`rating:${p1}`)) || 1000;
    const rating2 = Number(await redis.get(`rating:${p2}`)) || 1000;

    const p1Wins = winnerId === p1;

    const newRating1 = calculateElo(rating1, rating2, p1Wins ? 1 : 0);
    const newRating2 = calculateElo(rating2, rating1, p1Wins ? 0 : 1);

    await redis.set(`rating:${p1}`, newRating1);
    await redis.set(`rating:${p2}`, newRating2);

    await redis.hset("users:ratings", {
      [p1]: String(newRating1),
      [p2]: String(newRating2),
    });

    await redis.hset(`match:${matchId}`, {
      status: "completed",
      winnerId,
      ratingChange1: String(newRating1 - rating1),
      ratingChange2: String(newRating2 - rating2),
    });

    return NextResponse.json({
      ok: true,
      winnerId,
      p1,
      p2,
      rating1: newRating1,
      rating2: newRating2,
    });
  } catch (error) {
    console.error("match/end error", error);
    return NextResponse.json({ error: "Failed to end match" }, { status: 500 });
  }
}