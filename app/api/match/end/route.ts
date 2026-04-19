import { NextResponse } from "next/server";
import { redis } from "@/lib/redis";

type MatchRecord = {
  matchId?: string;
  player1Id?: string;
  player2Id?: string;
  status?: string;
  winnerId?: string;
  player1Submitted?: string;
  player2Submitted?: string;
};

function calculateElo(ratingA: number, ratingB: number, scoreA: number) {
  const K = 32;
  const expectedA = 1 / (1 + Math.pow(10, (ratingB - ratingA) / 400));
  return Math.round(ratingA + K * (scoreA - expectedA));
}

export async function POST(req: Request) {
  try {
    const body = (await req.json()) as { matchId?: string; userId?: string };
    const { matchId, userId } = body;

    if (!matchId || !userId) {
      return NextResponse.json(
        { error: "Missing matchId or userId" },
        { status: 400 }
      );
    }

    const rawMatch = await redis.hgetall(`match:${matchId}`);
    const match = rawMatch as MatchRecord | null;

    if (!match || !match.matchId) {
      return NextResponse.json({ error: "Match not found" }, { status: 404 });
    }

    if (match.status === "completed") {
      return NextResponse.json({
        ok: true,
        alreadyCompleted: true,
        status: "completed",
        winnerId: match.winnerId || null,
      });
    }

    const p1 = match.player1Id || "";
    const p2 = match.player2Id || "";

    if (userId !== p1 && userId !== p2) {
      return NextResponse.json(
        { error: "User is not part of this match" },
        { status: 400 }
      );
    }

    if (userId === p1) {
      await redis.hset(`match:${matchId}`, { player1Submitted: "true" });
    } else {
      await redis.hset(`match:${matchId}`, { player2Submitted: "true" });
    }

    const rawUpdated = await redis.hgetall(`match:${matchId}`);
    const updatedMatch = rawUpdated as MatchRecord | null;

    const player1Submitted = updatedMatch?.player1Submitted === "true";
    const player2Submitted = updatedMatch?.player2Submitted === "true";

    if (!player1Submitted || !player2Submitted) {
      return NextResponse.json({
        ok: true,
        status: "waiting",
        player1Submitted,
        player2Submitted,
      });
    }

    const rating1 = Number(await redis.get(`rating:${p1}`)) || 1000;
    const rating2 = Number(await redis.get(`rating:${p2}`)) || 1000;

    const winnerId = Math.random() > 0.5 ? p1 : p2;
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
      status: "completed",
      winnerId,
      player1Submitted,
      player2Submitted,
    });
  } catch (error) {
    console.error("match/end error", error);
    return NextResponse.json({ error: "Failed to end match" }, { status: 500 });
  }
}