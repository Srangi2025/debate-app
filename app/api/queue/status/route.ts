import { NextResponse } from "next/server";
import { redis } from "@/lib/redis";

type MatchData = {
  matchId?: string;
  player1Id?: string;
  player2Id?: string;
  player1Username?: string;
  player2Username?: string;
  player1Side?: string;
  player2Side?: string;
  topicId?: string;
};

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const userId = searchParams.get("userId");

    if (!userId) {
      return NextResponse.json({ error: "Missing userId" }, { status: 400 });
    }

    const queueData = await redis.hgetall(`queue:user:${userId}`);
    const matchId = await redis.get<string | null>(`match:user:${userId}`);

    const isQueued = !!queueData && Object.keys(queueData).length > 0;

    if (!matchId) {
      return NextResponse.json({
        queued: isQueued,
        matchFound: false,
        matchId: null,
      });
    }

    const matchData = (await redis.hgetall(
      `match:${matchId}`
    )) as MatchData | null;

    if (!matchData || !matchData.matchId) {
      return NextResponse.json({
        queued: false,
        matchFound: false,
        matchId: null,
      });
    }

    const isPlayer1 = userId === matchData.player1Id;

    const side = isPlayer1
      ? matchData.player1Side
      : matchData.player2Side;

    const opponentId = isPlayer1
      ? matchData.player2Id
      : matchData.player1Id;

    const opponentUsername = isPlayer1
      ? matchData.player2Username
      : matchData.player1Username;

    return NextResponse.json({
      queued: false,
      matchFound: true,
      matchId,
      topicId: matchData.topicId ?? null,
      side: side ?? null,
      opponentId: opponentId ?? null,
      opponentUsername: opponentUsername ?? null,
    });
  } catch (error) {
    console.error("queue/status error", error);
    return NextResponse.json(
      { error: "Failed to get queue status" },
      { status: 500 }
    );
  }
}