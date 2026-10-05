"use client";

import { authenticatedFetch } from "@/lib/guest-auth";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { useParams } from "next/navigation";
import { TOPICS } from "@/lib/topics";

type Player = {
  userId: string;
  username: string;
};

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
};

export default function ResultPage() {
  const params = useParams<{ id: string }>();
  const [resultData, setResultData] = useState<ResultResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  useEffect(() => {
    let active = true;

    const fetchResult = async () => {
      try {
        const res = await authenticatedFetch(`/api/result/${params.id}`);
        const data = await res.json();
        if (!active) return;

        if (!res.ok) {
          setErrorMessage(
            res.status === 404 && data.error === "Result not found"
              ? "This match does not have a result yet. Both players need to submit their debate."
              : res.status >= 500
                ? `${data.error || "The server could not load this result"}. Please try again shortly.`
                : data.error || "Unable to load this result. Please try again."
          );
          return;
        }

        setResultData(data);
        setErrorMessage(null);
      } catch (error) {
        console.error(error);
        if (active) {
          setErrorMessage(
            error instanceof Error && !(error instanceof TypeError) && !(error instanceof SyntaxError) && error.message
              ? error.message
              : "Unable to load the result. Check your connection and try again."
          );
        }
      } finally {
        if (active) setLoading(false);
      }
    };

    fetchResult();
    return () => { active = false; };
  }, [params.id]);

  const topicTitles = useMemo(() => {
    if (!resultData?.topics?.length) return [];

    return resultData.topics.map((topicId) => {
      const found = TOPICS.find((topic) => topic.id === topicId);
      return found?.title ?? topicId;
    });
  }, [resultData]);

  if (loading) {
    return (
      <main className="min-h-screen bg-white px-6 py-10 text-black">
        <div className="mx-auto max-w-3xl">
          <h1 className="text-4xl font-bold">Loading result...</h1>
          <p className="mt-3 text-gray-600">Fetching the saved outcome for this match.</p>
        </div>
      </main>
    );
  }

  if (errorMessage || !resultData) {
    return (
      <main className="min-h-screen bg-white px-6 py-10 text-black">
        <div className="mx-auto max-w-3xl">
          <h1 className="text-4xl font-bold">Result unavailable</h1>
          <p role="alert" className="mt-3 text-gray-700">
            {errorMessage || "This match does not have a saved result yet."}
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

  const winnerLabel = resultData.winner?.username || "No winner recorded";
  const usesResponseLength = !resultData.judgeMethod || resultData.judgeMethod === "response-length";

  return (
    <main className="min-h-screen bg-white px-6 py-10 text-black">
      <div className="mx-auto max-w-3xl">
        <p className="text-sm uppercase tracking-wide text-gray-500">
          Match Result
        </p>
        <h1 className="mt-2 text-4xl font-bold">Match {resultData.matchId}</h1>

        <div className="mt-8 rounded-2xl border p-8">
          <div className="rounded-xl bg-black p-8 text-white">
            <p className="text-sm uppercase tracking-wide opacity-70">Winner</p>
            <p className="mt-3 text-4xl font-bold">{winnerLabel}</p>
          </div>

          <div className="mt-6 grid gap-4 sm:grid-cols-2">
            <div className="rounded-xl bg-gray-100 p-5">
              <p className="text-sm text-gray-500">Player 1</p>
              <p className="mt-2 text-2xl font-semibold">
                {resultData.player1?.username || "Unknown"}
              </p>
            </div>

            <div className="rounded-xl bg-gray-100 p-5">
              <p className="text-sm text-gray-500">Player 2</p>
              <p className="mt-2 text-2xl font-semibold">
                {resultData.player2?.username || "Unknown"}
              </p>
            </div>
          </div>

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
                <p className="text-gray-700">No topics available.</p>
              )}
            </div>
          </div>

          <div className="mt-6 rounded-xl border p-5">
            <p className="text-sm uppercase tracking-wide text-gray-500">
              Scoring
            </p>
            <p className="mt-3 font-semibold">
              {usesResponseLength ? "Temporary response-length scoring" : resultData.judgeMethod}
            </p>
            {usesResponseLength && (
              <p className="mt-2 text-gray-700">
                The longer submitted response wins. Equal lengths go to Player 1.
              </p>
            )}
            {resultData.judgeReason && (
              <p className="mt-3 text-gray-700">{resultData.judgeReason}</p>
            )}
          </div>

          <div className="mt-6 rounded-xl border p-5">
            <p className="text-sm uppercase tracking-wide text-gray-500">
              Status
            </p>
            <p className="mt-3 text-gray-700">
              {resultData.status || "finished"}
            </p>
          </div>

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
