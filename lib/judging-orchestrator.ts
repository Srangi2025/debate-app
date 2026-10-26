
import "server-only";

import { TOPICS } from "@/lib/topics";
import { redis } from "@/lib/redis";
import { evaluateDebate } from "@/lib/ai-judge";
import {
  acquireJudgingLock,
  releaseJudgingLock,
} from "@/lib/judging-lock";
import { finalizeAIJudgment } from "@/lib/judging-finalization";

type Player = {
  userId: string;
  username: string;
};

type Match = {
  id: string;
  status: string;
  topics?: string[];
  player1: Player;
  player2: Player;
};

type Submission = {
  userId: string;
  transcript: string;
};

function parseStored<T>(value: unknown): T {
  if (typeof value === "string") {
    return JSON.parse(value) as T;
  }
  return value as T;
}

export async function processDebateJudgment(matchId: string) {
  const lockToken = await acquireJudgingLock(matchId);

  if (!lockToken) {
    return {
      status: "already_processing" as const,
    };
  }

  try {
    const storedMatch = await redis.get(`match:${matchId}`);

    if (!storedMatch) {
      throw new Error("Match not found");
    }

    const match = parseStored<Match>(storedMatch);

    if (match.status === "ended") {
      return { status: "already_completed" as const };
    }

    if (match.status !== "pending_judgment") {
      throw new Error(
        `Cannot judge match with status ${match.status}`
      );
    }

    const submissionsKey = `match:${matchId}:submissions`;

    const [storedA, storedB] = await Promise.all([
      redis.hget(submissionsKey, match.player1.userId),
      redis.hget(submissionsKey, match.player2.userId),
    ]);

    if (!storedA || !storedB) {
      throw new Error("Both submissions are required");
    }

    const submissionA = parseStored<Submission>(storedA);
    const submissionB = parseStored<Submission>(storedB);

    if (
      submissionA.userId !== match.player1.userId ||
      submissionB.userId !== match.player2.userId
    ) {
      throw new Error("Submission ownership mismatch");
    }

    if (
      !submissionA.transcript?.trim() ||
      !submissionB.transcript?.trim()
    ) {
      throw new Error("Debate transcripts cannot be empty");
    }

    const topic =
      match.topics?.map((id) => TOPICS.find((topic) => topic.id === id)?.title ?? id).join(", ") || "General debate";

    const judgment = await evaluateDebate(
      topic,
      submissionA.transcript,
      submissionB.transcript
    );

    const finalized = await finalizeAIJudgment(
      matchId,
      lockToken,
      judgment
    );

    if (!finalized.ok) {
      return {
        status: "finalization_failed" as const,
        reason: finalized.reason,
      };
    }

    return {
      status: "completed" as const,
      judgment,
    };
  } catch (error) {
    console.error("AI judging failed:", error);

    return {
      status: "failed" as const,
      error:
        error instanceof Error
          ? error.message
          : "Unknown judging error",
    };
  } finally {
    await releaseJudgingLock(matchId, lockToken);
  }
}
