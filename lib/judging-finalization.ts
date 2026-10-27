
import "server-only";
import { redis } from "@/lib/redis";
import type { AIJudgeResult } from "@/lib/ai-judge";

import { FINALIZE_JUDGMENT_SCRIPT } from "./judging-finalization-script";

type FinalizationResponse = {
  ok: boolean;
  status?: string;
  reason?: string;
};

export async function finalizeAIJudgment(
  matchId: string,
  lockToken: string,
  judgment: AIJudgeResult
): Promise<FinalizationResponse> {
  return redis.eval<unknown[], FinalizationResponse>(
    FINALIZE_JUDGMENT_SCRIPT,
    [
      `match:${matchId}`,
      `result:${matchId}`,
      `match:${matchId}:judging-lock`,
      "history:pending",
    ],
    [
      lockToken,
      JSON.stringify(judgment),
      Date.now(),
    ]
  );
}
