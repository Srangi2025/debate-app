
export type FinalSourceCheck = {
  id: string; side: "A" | "B"; quote: string;
  verdict: "supported" | "contradicted" | "mixed" | "unverified";
  reason: string;
  evidence: { title: string; url: string; provider: string; retrievedAt: string; quote: string }[];
};

export type ReviewCoverage = {
  mode: "full" | "summarized";
  characters: { A: number; B: number };
  chunks: { A: number; B: number };
  context_tokens: number; checked_claims: number; candidate_claims: number;
  warnings: string[];
};

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
  source_checks?: FinalSourceCheck[];
  evidence_used?: string[];
  review?: ReviewCoverage;
};

export async function evaluateDebate(
  topic: string,
  argumentA: string,
  argumentB: string,
  signal?: AbortSignal
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
    signal: AbortSignal.any([AbortSignal.timeout(620000), ...(signal ? [signal] : [])]),
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
  const total = (side: string) => {
    const scores = (data.scores as Record<string, Record<string, number>>)[side];
    return Math.round((scores.reasoning * 0.30 + scores.evidence * 0.25 + scores.rebuttals * 0.25 + scores.relevance * 0.20) * 100) / 100;
  };
  const a = total("A"), b = total("B");
  if (Math.abs(a - (data.weighted_scores.A as number)) > 1e-8 || Math.abs(b - (data.weighted_scores.B as number)) > 1e-8 ||
      data.winner !== (Math.abs(a - b) <= 0.25 + 1e-8 ? "tie" : a > b ? "A" : "B")) return false;
  if (data.source_checks !== undefined || data.review !== undefined || data.judge_version === "ollama-grounded-v2") {
    if (!Array.isArray(data.source_checks) || data.source_checks.length > 4 ||
        !Array.isArray(data.evidence_used) || !data.evidence_used.every(id => typeof id === "string") ||
        !record(data.review)) return false;
    const checks = data.source_checks;
    const ids = new Set<string>();
    for (const check of checks) {
      if (!record(check) || typeof check.id !== "string" || !/^F[1-4]$/.test(check.id) || ids.has(check.id) ||
          !["A", "B"].includes(String(check.side)) || typeof check.quote !== "string" || !check.quote.trim() || check.quote.length > 500 ||
          !["supported", "contradicted", "mixed", "unverified"].includes(String(check.verdict)) ||
          typeof check.reason !== "string" || check.reason.length > 1000 || !Array.isArray(check.evidence) || check.evidence.length > 2) return false;
      ids.add(check.id);
      if (check.verdict !== "unverified" && check.evidence.length === 0) return false;
      for (const source of check.evidence) {
        if (!record(source) || !["title", "url", "provider", "retrievedAt", "quote"].every(key => typeof source[key] === "string" && !!source[key]) ||
            typeof source.url !== "string" || !source.url.startsWith("https://en.wikipedia.org/wiki/") ||
            typeof source.quote !== "string" || source.quote.length > 500) return false;
        try { const url = new URL(source.url); if (url.origin !== "https://en.wikipedia.org" || url.username || url.password) return false; } catch { return false; }
      }
    }
    if (new Set(data.evidence_used).size !== data.evidence_used.length || data.evidence_used.some(id => !ids.has(id))) return false;
    if (checks.some(check => check.verdict !== "unverified" && !(data.evidence_used as string[]).includes(check.id))) return false;
    const review = data.review;
    const count = (value: unknown) => typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
    if (!record(review.characters) || !record(review.chunks)) return false;
    const characters = review.characters, chunks = review.chunks;
    if (!["full", "summarized"].includes(String(review.mode)) ||
        !["A", "B"].every(side => count(characters[side]) && count(chunks[side]) && (chunks[side] as number) > 0) ||
        !count(review.context_tokens) || !count(review.checked_claims) || review.checked_claims !== checks.length ||
        !count(review.candidate_claims) || (review.candidate_claims as number) < checks.length ||
        !Array.isArray(review.warnings) || !review.warnings.every(item => typeof item === "string")) return false;
  }
  return true;
}
