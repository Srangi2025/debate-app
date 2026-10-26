
export type AIJudgeResult = {
  winner: "A" | "B" | "tie";
  reasoning: string;
  scores: {
    A: Record<string, number>;
    B: Record<string, number>;
  };
  weighted_scores: {
    A: number;
    B: number;
  };
  strengths: {
    A: string[];
    B: string[];
  };
  improvements: {
    A: string[];
    B: string[];
  };
  judge_version: string;
  rubric_version: string;
};

export async function evaluateDebate(
  topic: string,
  argumentA: string,
  argumentB: string
): Promise<AIJudgeResult> {
  const AI_JUDGE_URL = process.env.AI_JUDGE_URL;
  if (!AI_JUDGE_URL) {
    throw new Error("AI_JUDGE_URL is not configured");
  }

  const response = await fetch(`${AI_JUDGE_URL}/judge`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      topic,
      argument_a: argumentA,
      argument_b: argumentB,
    }),
    signal: AbortSignal.timeout(180000),
    cache: "no-store",
  });

  if (!response.ok) {
    throw new Error(
      `AI judge returned HTTP ${response.status}`
    );
  }

  const result: unknown = await response.json();

  if (!isAIJudgeResult(result)) {
    throw new Error("Invalid response from AI judge");
  }

  return result;
}

export function isAIJudgeResult(value: unknown): value is AIJudgeResult {
  if (!value || typeof value !== "object") return false;
  const data = value as Record<string, unknown>;
  const record = (value: unknown): value is Record<string, unknown> => !!value && typeof value === "object" && !Array.isArray(value);
  const number = (value: unknown) => typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 10;
  if (!["A", "B", "tie"].includes(String(data.winner)) ||
      typeof data.reasoning !== "string" || !data.reasoning.trim() ||
      typeof data.judge_version !== "string" || typeof data.rubric_version !== "string" ||
      !record(data.scores) || !record(data.weighted_scores) || !record(data.strengths) || !record(data.improvements)) return false;
  for (const side of ["A", "B"]) {
    const scores = data.scores[side];
    if (!record(scores) || !["reasoning", "evidence", "rebuttals", "relevance"].every(key => number(scores[key]) && Number.isInteger(scores[key])) ||
        !number(data.weighted_scores[side])) return false;
    for (const group of [data.strengths, data.improvements]) {
      const items = group[side];
      if (!Array.isArray(items) || !items.every(item => typeof item === "string")) return false;
    }
  }
  return true;
}
