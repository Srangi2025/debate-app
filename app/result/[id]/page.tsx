
"use client";

import { authenticatedFetch } from "@/lib/guest-auth";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useParams } from "next/navigation";
import { TOPICS } from "@/lib/topics";

type Player = {
  userId: string;
  username: string;
};

type Side = "A" | "B";

type ResultResponse = {
  matchId: string;
  topics: string[];
  endedAt: number;
  winner: Player | null;
  loser: Player | null;
  player1: Player | null;
  player2: Player | null;
  status: string;
  judgeReason?: string;
  judgeMethod?: string;
  judgeVersion?: string;
  rubricVersion?: string;
  scores?: Record<Side, Record<string, number>>;
  weightedScores?: Record<Side, number>;
  strengths?: Record<Side, string[]>;
  improvements?: Record<Side, string[]>;
  judgingJob?: {
    status: "queued" | "judging" | "retrying" | "failed" | "completed";
    attempts: number;
    queuedAt: number;
    nextAttemptAt?: number;
    error?: string;
  } | null;
  workerOnline?: boolean;
};

export default function ResultPage() {
  const { id: matchId } = useParams<{ id: string }>();

  return <MatchResult key={matchId} matchId={matchId} />;
}

function MatchResult({ matchId }: { matchId: string }) {
  const [resultData, setResultData] = useState<ResultResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [judging, setJudging] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [judgingError, setJudgingError] = useState<string | null>(null);

  const judgingRequestRef = useRef(false);
  const judgingAttemptedRef = useRef<string | null>(null);
  const resultFinishedRef = useRef(false);

  // Request AI evaluation from the Next.js backend.
  const triggerAIJudging = useCallback(async () => {
    if (!matchId || judgingRequestRef.current || resultFinishedRef.current) {
      return;
    }

    judgingRequestRef.current = true;
    setJudging(true);
    setJudgingError(null);

    try {
      const response = await authenticatedFetch("/api/match/judge", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ matchId }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || "AI judging request failed");
      }

      // Another player may already be judging this match.
      // Either way, polling will wait for the saved result.
      console.log("AI judging status:", data.status);
    } catch (error) {
      console.error("AI judging error:", error);

      setJudgingError(
        error instanceof Error
          ? error.message
          : "AI judging failed. Please try again."
      );
    } finally {
      judgingRequestRef.current = false;
      setJudging(false);
    }
  }, [matchId]);

  // Manually retry a failed or stalled evaluation.
  const retryAIJudging = () => {
    if (judgingRequestRef.current || resultFinishedRef.current) {
      return;
    }

    judgingAttemptedRef.current = matchId;
    setJudgingError(null);

    void triggerAIJudging();
  };

  // Repair older pending results created before durable jobs were introduced.
  useEffect(() => {
    if (resultData?.status !== "pending_judgment" || resultData.judgingJob || !matchId) {
      return;
    }

    if (judgingAttemptedRef.current === matchId) {
      return;
    }

    judgingAttemptedRef.current = matchId;

    void triggerAIJudging();
  }, [resultData?.status, resultData?.judgingJob, matchId, triggerAIJudging]);

  // Retrieve the saved result and poll while judging is pending.
  useEffect(() => {
    if (!matchId) return;

    let active = true;
    let fetching = false;

    resultFinishedRef.current = false;
    judgingAttemptedRef.current = null;

    const fetchResult = async () => {
      if (!active || fetching || resultFinishedRef.current) {
        return;
      }

      fetching = true;

      try {
        const res = await authenticatedFetch(`/api/result/${matchId}`);
        const data = await res.json();

        if (!active) return;

        if (!res.ok) {
          setErrorMessage(
            res.status === 404 && data.error === "Result not found"
              ? "This match does not have a result yet. Both players need to submit their debate."
              : data.error || "Unable to load this result. Please try again."
          );
          return;
        }

        setResultData(data as ResultResponse);
        setErrorMessage(null);

        resultFinishedRef.current = [
          "finished",
          "completed",
          "ended",
        ].includes(data.status);
      } catch (error) {
        console.error("Result polling error:", error);

        if (active) {
          setErrorMessage(
            "Unable to load the result. Check your connection and try again."
          );
        }
      } finally {
        fetching = false;

        if (active) {
          setLoading(false);
        }
      }
    };

    void fetchResult();

    const interval = setInterval(() => {
      if (resultFinishedRef.current) {
        clearInterval(interval);
        return;
      }

      void fetchResult();
    }, 3000);

    return () => {
      active = false;
      clearInterval(interval);
    };
  }, [matchId]);

  // Convert topic IDs to readable topic names.
  const topicTitles = useMemo(
    () =>
      (resultData?.topics ?? []).map((topicId) => {
        const found = TOPICS.find((topic) => topic.id === topicId);
        return found?.title ?? topicId;
      }),
    [resultData?.topics]
  );

  // Loading state.
  if (loading) {
    return (
      <main className="min-h-screen bg-white px-6 py-10 text-black">
        <div className="mx-auto max-w-3xl">
          <h1 className="text-4xl font-bold">
            Loading result...
          </h1>

          <p className="mt-3 text-gray-600">
            Fetching the saved outcome for this match.
          </p>
        </div>
      </main>
    );
  }

  // Result does not exist or cannot be retrieved.
  if (!resultData) {
    return (
      <main className="min-h-screen bg-white px-6 py-10 text-black">
        <div className="mx-auto max-w-3xl">
          <h1 className="text-4xl font-bold">
            Result unavailable
          </h1>

          <p role="alert" className="mt-3 text-gray-700">
            {errorMessage ||
              "This match does not have a saved result yet."}
          </p>

          <button
            type="button"
            onClick={() => window.location.reload()}
            className="mt-6 mr-4 rounded-lg bg-black px-6 py-3 text-white"
          >
            Try Again
          </button>

          <Link
            href="/dashboard"
            className="mt-6 inline-block rounded-lg border px-6 py-3"
          >
            Back to Dashboard
          </Link>
        </div>
      </main>
    );
  }

  // Qwen is currently evaluating the debate.
  if (
    resultData.status === "pending_judgment" ||
    resultData.status === "judging"
  ) {
    const jobStatus = resultData.judgingJob?.status ?? "queued";
    const title = jobStatus === "failed" ? "AI judging needs a retry"
      : resultData.workerOnline === false ? "Your debate is saved for judging"
      : jobStatus === "retrying" ? "Judging will retry automatically"
      : jobStatus === "judging" ? "AI is evaluating your debate"
      : "Your debate is queued for judging";
    return (
      <main className="min-h-screen bg-white px-6 py-10 text-black">
        <div className="mx-auto max-w-3xl rounded-2xl border p-8">
          <h1 aria-live="polite" className="text-3xl font-bold">
            {title}
          </h1>

          <p className="mt-4 text-gray-600">
            {jobStatus === "failed"
              ? "Both submissions are saved. Retry when you're ready, or return to this result later."
              : resultData.workerOnline === false
                ? "Both submissions are saved. Judging will resume when the AI judge reconnects."
                : jobStatus === "judging"
                  ? "Qwen is reviewing both arguments for logical reasoning, supporting evidence, rebuttals, and relevance."
                  : "Both submissions are saved. Your debate will be evaluated as soon as the AI judge is available."}
          </p>

          <p className="mt-4 text-sm text-gray-500">
            Your debate has been submitted successfully.
            Results will appear after judging finishes.
          </p>

          {errorMessage && (
            <p role="alert" className="mt-4 text-sm text-red-600">
              Result refresh issue: {errorMessage}
            </p>
          )}

          {judgingError && (
            <p role="alert" className="mt-4 text-sm text-red-600">
              {judgingError}
            </p>
          )}

          {resultData.judgingJob?.error && (
            <p role={jobStatus === "failed" ? "alert" : "status"} className="mt-4 text-sm text-gray-700">
              {resultData.judgingJob.error}
            </p>
          )}

          {(jobStatus === "failed" || !resultData.judgingJob) && (
          <button
            type="button"
            onClick={retryAIJudging}
            disabled={judging}
            className="mt-4 rounded-lg bg-black px-5 py-2 text-white disabled:opacity-50"
          >
            {judging
              ? "Queuing..."
              : "Retry AI Judging"}
          </button>
          )}
          <Link href="/dashboard" className="mt-6 block text-sm underline">Back to Dashboard</Link>
        </div>
      </main>
    );
  }

  // Final judgment display.
  const winnerLabel =
    resultData.winner?.username || "Tie / no winner recorded";

  const usesResponseLength =
    !resultData.judgeMethod ||
    resultData.judgeMethod === "response-length";

  return (
    <main className="min-h-screen bg-white px-6 py-10 text-black">
      <div className="mx-auto max-w-3xl">
        <p className="text-sm uppercase tracking-wide text-gray-500">
          Match Result
        </p>

        <h1 className="mt-2 text-4xl font-bold">
          Match {resultData.matchId}
        </h1>

        <div className="mt-8 rounded-2xl border p-8">
          {/* Winner */}
          <div className="rounded-xl bg-black p-8 text-white">
            <p className="text-sm uppercase tracking-wide opacity-70">
              Winner
            </p>

            <p className="mt-3 text-4xl font-bold">
              {winnerLabel}
            </p>
          </div>

          {/* Players */}
          <div className="mt-6 grid gap-4 sm:grid-cols-2">
            {(["A", "B"] as const).map((side) => {
              const player =
                side === "A"
                  ? resultData.player1
                  : resultData.player2;

              return (
                <div
                  key={side}
                  className="rounded-xl bg-gray-100 p-5"
                >
                  <p className="text-sm text-gray-500">
                    Player {side === "A" ? "1" : "2"} (Side {side})
                  </p>

                  <p className="mt-2 text-2xl font-semibold">
                    {player?.username || "Unknown"}
                  </p>
                </div>
              );
            })}
          </div>

          {/* Debate Topics */}
          <div className="mt-6 rounded-xl border p-5">
            <p className="text-sm uppercase tracking-wide text-gray-500">
              Topics
            </p>

            <div className="mt-3 flex flex-wrap gap-2">
              {topicTitles.length > 0 ? (
                topicTitles.map((title) => (
                  <span
                    key={title}
                    className="rounded-full border px-3 py-1 text-sm"
                  >
                    {title}
                  </span>
                ))
              ) : (
                <p className="text-gray-700">
                  No topics available.
                </p>
              )}
            </div>
          </div>

          {/* AI Evaluation */}
          <div className="mt-6 rounded-xl border p-5">
            <p className="text-sm uppercase tracking-wide text-gray-500">
              Scoring
            </p>

            <p className="mt-3 font-semibold">
              {usesResponseLength
                ? "Temporary response-length scoring"
                : resultData.judgeMethod}
            </p>

            {usesResponseLength && (
              <p className="mt-2 text-gray-700">
                The longer submitted response wins.
                Equal lengths go to Player 1.
              </p>
            )}

            {/* AI Reasoning */}
            {resultData.judgeReason && (
              <p className="mt-3 text-gray-700">
                {resultData.judgeReason}
              </p>
            )}

            {/* AI Rubric Scores */}
            {resultData.scores && (
              <div className="mt-5 grid gap-4 sm:grid-cols-2">
                {(["A", "B"] as const).map((side) => (
                  <div
                    key={side}
                    className="rounded-lg bg-gray-50 p-4"
                  >
                    <h2 className="font-semibold">
                      Side {side}:{" "}
                      {side === "A"
                        ? resultData.player1?.username
                        : resultData.player2?.username}
                    </h2>

                    {resultData.weightedScores?.[side] !== undefined && (
                      <p className="mt-2 font-medium">
                        Weighted score:{" "}
                        {resultData.weightedScores[side].toFixed(2)}
                      </p>
                    )}

                    {Object.entries(
                      resultData.scores?.[side] ?? {}
                    ).map(([criterion, score]) => (
                      <p
                        key={criterion}
                        className="mt-1 text-sm capitalize text-gray-700"
                      >
                        {criterion}: {score}
                      </p>
                    ))}

                    {/* Strengths */}
                    {(resultData.strengths?.[side]?.length ?? 0) > 0 && (
                      <div className="mt-3">
                        <p className="text-sm font-semibold">
                          Strengths
                        </p>

                        {resultData.strengths?.[side].map(
                          (item, index) => (
                            <p
                              key={index}
                              className="mt-1 text-sm text-gray-700"
                            >
                              • {item}
                            </p>
                          )
                        )}
                      </div>
                    )}

                    {/* Improvements */}
                    {(resultData.improvements?.[side]?.length ?? 0) > 0 && (
                      <div className="mt-3">
                        <p className="text-sm font-semibold">
                          Areas to improve
                        </p>

                        {resultData.improvements?.[side].map(
                          (item, index) => (
                            <p
                              key={index}
                              className="mt-1 text-sm text-gray-700"
                            >
                              • {item}
                            </p>
                          )
                        )}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}

            {/* Model Version Information */}
            {(resultData.judgeVersion ||
              resultData.rubricVersion) && (
              <p className="mt-4 text-xs text-gray-500">
                Judge: {resultData.judgeVersion || "unknown"}
                {" · "}
                Rubric: {resultData.rubricVersion || "unknown"}
              </p>
            )}
          </div>

          {/* Match Status */}
          <div className="mt-6 rounded-xl border p-5">
            <p className="text-sm uppercase tracking-wide text-gray-500">
              Status
            </p>

            <p className="mt-3 text-gray-700">
              {resultData.status || "finished"}
            </p>
          </div>

          {/* Navigation */}
          <div className="mt-8 flex flex-wrap gap-4">
            <Link
              href="/dashboard"
              className="rounded-lg bg-black px-6 py-3 text-white"
            >
              Back to Dashboard
            </Link>

            <Link
              href="/leaderboard"
              className="rounded-lg border px-6 py-3 text-black"
            >
              View Leaderboard
            </Link>
          </div>
        </div>
      </div>
    </main>
  );
}
