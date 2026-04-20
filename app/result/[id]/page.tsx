"use client";

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
};

export default function ResultPage() {
  const params = useParams();
  const [resultData, setResultData] = useState<ResultResponse | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchResult = async () => {
      try {
        const res = await fetch(`/api/result/${params.id}`);
        if (!res.ok) {
          setLoading(false);
          return;
        }

        const data = await res.json();
        setResultData(data);
        setLoading(false);
      } catch (error) {
        console.error(error);
        setLoading(false);
      }
    };

    fetchResult();
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
        </div>
      </main>
    );
  }

  if (!resultData) {
    return (
      <main className="min-h-screen bg-white px-6 py-10 text-black">
        <div className="mx-auto max-w-3xl">
          <h1 className="text-4xl font-bold">Result not found</h1>
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