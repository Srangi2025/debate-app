import { NextRequest, NextResponse } from "next/server";
import { redis } from "@/lib/redis";

type Player = {
  userId: string;
  username: string;
};

type MatchRecord = {
  id: string;
  topics: string[];
  createdAt: number;
  status: string;
  player1: Player | null;
  player2: Player | null;
};

type Submission = {
  userId: string;
  transcript: string;
  submittedAt: number;
};

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();

    const matchId = String(body.matchId || "").trim();
    const userId = String(body.userId || "").trim();
    const transcript = String(body.transcript || "").trim();

    if (!matchId || !userId || !transcript) {
      return NextResponse.json(
        { error: "Missing matchId, userId, or transcript" },
        { status: 400 }
      );
    }

    const match = await redis.get<MatchRecord>(`match:${matchId}`);
    if (!match) {
      return NextResponse.json({ error: "Match not found" }, { status: 404 });
    }

    if (match.status === "ended") {
      return NextResponse.json({
        ok: true,
        alreadyCompleted: true,
        resultUrl: `/result/${matchId}`,
      });
    }

    const submissionsKey = `match:${matchId}:submissions`;

    const submission: Submission = {
      userId,
      transcript,
      submittedAt: Date.now(),
    };

    await redis.hset(submissionsKey, {
      [userId]: JSON.stringify(submission),
    });
    await redis.expire(submissionsKey, 3600);

    const rawPlayer1Submission = match.player1?.userId
      ? await redis.hget<string>(submissionsKey, match.player1.userId)
      : null;

    const rawPlayer2Submission = match.player2?.userId
      ? await redis.hget<string>(submissionsKey, match.player2.userId)
      : null;

    const player1Submission = rawPlayer1Submission
      ? JSON.parse(rawPlayer1Submission)
      : null;

    const player2Submission = rawPlayer2Submission
      ? JSON.parse(rawPlayer2Submission)
      : null;

    if (!player1Submission || !player2Submission) {
      return NextResponse.json({
        ok: true,
        status: "waiting",
      });
    }

    const player1Length = player1Submission.transcript.trim().length;
    const player2Length = player2Submission.transcript.trim().length;

    let winner = null;
    let loser = null;

    if (player1Length >= player2Length) {
      winner = match.player1;
      loser = match.player2;
    } else {
      winner = match.player2;
      loser = match.player1;
    }

    const endedAt = Date.now();

    const result = {
      matchId,
      topics: Array.isArray(match.topics) ? match.topics : [],
      endedAt,
      winner,
      loser,
      player1: match.player1,
      player2: match.player2,
      status: "finished",
      judgeReason:
        player1Length >= player2Length
          ? "Player 1 submitted the stronger response based on response completeness."
          : "Player 2 submitted the stronger response based on response completeness.",
    };

    await redis.set(`result:${matchId}`, result);

    await redis.set(`match:${matchId}`, {
      ...match,
      status: "ended",
      endedAt,
    });

    if (match.player1?.userId) {
      await redis.del(`user:${match.player1.userId}:match`);
    }

    if (match.player2?.userId) {
      await redis.del(`user:${match.player2.userId}:match`);
    }

    return NextResponse.json({
      ok: true,
      status: "completed",
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