import { isAIJudgeResult } from "./judge-client.ts";

// Restore canonical arrays after Lua finalization; never expose the duplicate
// serialized payload to the browser. Older results retain their existing shape.
export function resultPayload(result: Record<string, unknown>): Record<string, unknown> {
  const visible = { ...result };
  const serialized = visible.judgmentJson;
  delete visible.judgmentJson;
  if (serialized === undefined) return visible;
  if (typeof serialized !== "string") throw new Error("Saved judgment is invalid");
  const judgment: unknown = JSON.parse(serialized);
  if (!isAIJudgeResult(judgment)) throw new Error("Saved judgment is invalid");
  return {
    ...visible,
    scores: judgment.scores, weightedScores: judgment.weighted_scores,
    strengths: judgment.strengths, improvements: judgment.improvements,
    sourceChecks: judgment.source_checks, evidenceUsed: judgment.evidence_used,
    review: judgment.review,
  };
}
