"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { useParams, useSearchParams } from "next/navigation";
import { TOPICS } from "@/lib/topics";

type MatchResponse = {
  matchId: string;
  player1Id: string;
  player2Id: string;
  player1Username: string;
  player2Username: string;
  topicId: string;
  player1Side: string;
  player2Side: string;
  status: string;
  createdAt: string;
  winnerId: string | null;
  ratingChange1: string;
  ratingChange2: string;
  rating1: number;
  rating2: number;
};

export default function ResultPage() {
  const params = useParams();
  const searchParams = useSearchParams();
  const userId = searchParams.get("userId") || "";

  const [matchData, setMatchData] = useState<MatchResponse | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchMatch = async () => {
      try {
        const res = await fetch(`/api/match/${params.id}`);
        if (!res.ok) {
          setLoading(false);
          return;
        }

        const data = await res.json();
        setMatchData(data);
        setLoading(false);
      } catch (error) {
        console.error(error);
        setLoading(false);
      }
    };

    fetchMatch();
  }, [params.id]);

  const topicTitle = useMemo(() => {
    if (!matchData) return "";
    const found = TOPICS.find((topic) => topic.id === matchData.topicId);
    return found?.title ?? matchData.topicId;
  }, [matchData]);

  if (loading) {
    return (
      <main className="min-h-screen bg-white px-6 py-10 text-black">
        <div className="mx-auto max-w-3xl">
          <h1 className="text-4xl font-bold">Loading result...</h1>
        </div>
      </main>
    );
  }

  if (!matchData) {
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

  const isPlayer1 = userId === matchData.player1Id;
  const yourNewRating = isPlayer1 ? matchData.rating1 : matchData.rating2;
  const yourDelta = isPlayer1 ? matchData.ratingChange1 : matchData.ratingChange2;

  let winnerLabel = "Unknown";
  if (matchData.winnerId === matchData.player1Id) {
    winnerLabel =
      matchData.winnerId === userId ? "You" : matchData.player1Username;
  } else if (matchData.winnerId === matchData.player2Id) {
    winnerLabel =
      matchData.winnerId === userId ? "You" : matchData.player2Username;
  }

  return (
    <main className="min-h-screen bg-white px-6 py-10 text-black">
      <div className="mx-auto max-w-3xl">
        <p className="text-sm uppercase tracking-wide text-gray-500">
          Match Result
        </p>
        <h1 className="mt-2 text-4xl font-bold">Match {matchData.matchId}</h1>

        <div className="mt-8 rounded-2xl border p-8">
          <div className="rounded-xl bg-black p-8 text-white">
            <p className="text-sm uppercase tracking-wide opacity-70">Winner</p>
            <p className="mt-3 text-4xl font-bold">{winnerLabel}</p>
          </div>

          <div className="mt-6 grid gap-4 sm:grid-cols-2">
            <div className="rounded-xl bg-gray-100 p-5">
              <p className="text-sm text-gray-500">Your Rating Change</p>
              <p className="mt-2 text-3xl font-semibold">
                {yourDelta.startsWith("-") ? yourDelta : `+${yourDelta}`}
              </p>
            </div>

            <div className="rounded-xl bg-gray-100 p-5">
              <p className="text-sm text-gray-500">Your New Rating</p>
              <p className="mt-2 text-3xl font-semibold">{yourNewRating}</p>
            </div>
          </div>

          <div className="mt-6 rounded-xl border p-5">
            <p className="text-sm uppercase tracking-wide text-gray-500">
              Topic
            </p>
            <p className="mt-3 text-lg font-medium">{topicTitle}</p>
          </div>

          <div className="mt-6 rounded-xl border p-5">
            <p className="text-sm uppercase tracking-wide text-gray-500">
              AI Judge Summary
            </p>
            <p className="mt-3 text-gray-700">
              Temporary placeholder. Next step is replacing manual winner selection
              with real AI judging and a generated explanation.
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