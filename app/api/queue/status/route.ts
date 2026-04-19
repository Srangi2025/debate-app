import { NextResponse } from "next/server";
import { redis } from "@/lib/redis";

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const userId = searchParams.get("userId");

    if (!userId) {
      return NextResponse.json({ error: "Missing userId" }, { status: 400 });
    }

    const queueData = await redis.hgetall(`queue:user:${userId}`);
    const matchId = await redis.get(`match:user:${userId}`);

    if (!matchId) {
      return NextResponse.json({
        queued: Object.keys(queueData).length > 0,
        matchFound: false,
        matchId: null,
      });
    }

    const matchData = await redis.hgetall(`match:${matchId}`);

    if (!matchData || !matchData.matchId) {
      return NextResponse.json({
        queued: false,
        matchFound: false,
        matchId: null,
      });
    }

    const side =
      userId === matchData.player1Id
        ? matchData.player1Side
        : matchData.player2Side;

    const opponentId =
      userId === matchData.player1Id
        ? matchData.player2Id
        : matchData.player1Id;

    return NextResponse.json({
      queued: false,
      matchFound: true,
      matchId,
      topicId: matchData.topicId,
      side,
      opponentId,
    });
  } catch (error) {
    console.error("queue/status error", error);
    return NextResponse.json(
      { error: "Failed to get queue status" },
      { status: 500 }
    );
  }
}