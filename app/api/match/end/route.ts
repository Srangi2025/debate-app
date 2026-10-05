import { authenticate, authorizeMatch } from "@/lib/server-auth";
import { NextRequest, NextResponse } from "next/server";
import { redis } from "@/lib/redis";
import {
  MATCH_COMPLETION_SCRIPT,
  MAX_TRANSCRIPT_LENGTH,
  type CompletionResponse,
} from "@/lib/match-completion";

export async function POST(req: NextRequest) {
  try {
    const auth = await authenticate(req);
    if (auth.response) return auth.response;
    const userId = auth.userId;

    const body: unknown = await req.json().catch(() => null);
    if (!body || typeof body !== "object") {
      return NextResponse.json({ error: "Invalid submission" }, { status: 400 });
    }
    const values = body as Record<string, unknown>;
    const matchId = typeof values.matchId === "string" ? values.matchId.trim() : "";
    const transcript = typeof values.transcript === "string" ? values.transcript.trim() : "";
    if (!matchId || !transcript) {
      return NextResponse.json(
        { error: "A match ID and debate transcript are required" },
        { status: 400 }
      );
    }
    if (transcript.length > MAX_TRANSCRIPT_LENGTH) {
      return NextResponse.json(
        { error: "Keep your transcript at or below 20,000 characters" },
        { status: 400 }
      );
    }

    const access = await authorizeMatch(matchId, userId);
    if (access.response) return access.response;
    const match = access.match;
    if (!match.player1 || !match.player2) {
      return NextResponse.json(
        { error: "Both players must join before submitting" },
        { status: 409 }
      );
    }

    const now = Date.now();
    const outcome = await redis.eval<unknown[], CompletionResponse>(
      MATCH_COMPLETION_SCRIPT,
      [
        `match:${matchId}`,
        `match:${matchId}:submissions`,
        `result:${matchId}`,
        `user:${match.player1.userId}:match`,
        `user:${match.player2.userId}:match`,
      ],
      [
        userId,
        JSON.stringify({ userId, transcript, transcriptLength: transcript.length, submittedAt: now }),
        now,
        `/result/${matchId}`,
      ]
    );
    const { statusCode, ...response } = outcome;
    return NextResponse.json(response, { status: statusCode ?? 200 });
  } catch (error) {
    console.error("match/end error", error);
    return NextResponse.json(
      { error: "Unable to submit the debate. Please try again." },
      { status: 500 }
    );
  }
}
