"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { useParams, useSearchParams } from "next/navigation";
import { TOPICS } from "@/lib/topics";

type DebatePhase = {
  key: string;
  label: string;
  duration: number;
};

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
  winnerId?: string;
  ratingChange1?: string;
  ratingChange2?: string;
  judgeReason?: string;
};

const PHASES: DebatePhase[] = [
  { key: "prep", label: "Prep Time", duration: 30 },
  { key: "opening-a", label: "Opening Statement - You", duration: 60 },
  { key: "opening-b", label: "Opening Statement - Opponent", duration: 60 },
  { key: "discussion", label: "Open Discussion", duration: 120 },
  { key: "closing-a", label: "Closing Statement - You", duration: 60 },
  { key: "closing-b", label: "Closing Statement - Opponent", duration: 60 },
];

function formatTime(seconds: number) {
  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;
  return `${mins}:${secs.toString().padStart(2, "0")}`;
}

export default function MatchPage() {
  const params = useParams();
  const searchParams = useSearchParams();

  const userId = searchParams.get("userId") || "";

  const [matchData, setMatchData] = useState<MatchResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [ending, setEnding] = useState(false);
  const [waitingForOpponent, setWaitingForOpponent] = useState(false);
  const [transcript, setTranscript] = useState("");

  const [phaseIndex, setPhaseIndex] = useState(0);
  const [timeLeft, setTimeLeft] = useState(PHASES[0].duration);
  const [isFinished, setIsFinished] = useState(false);

  const currentPhase = useMemo(() => PHASES[phaseIndex], [phaseIndex]);

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

  useEffect(() => {
    if (!waitingForOpponent || !matchData) return;

    const interval = setInterval(async () => {
      const res = await fetch(`/api/match/${matchData.matchId}`);
      if (!res.ok) return;

      const data = await res.json();
      setMatchData(data);

      if (data.status === "completed") {
        clearInterval(interval);
        window.location.href = `/result/${data.matchId}?userId=${encodeURIComponent(
          userId
        )}`;
      }
    }, 2000);

    return () => clearInterval(interval);
  }, [waitingForOpponent, matchData, userId]);

  useEffect(() => {
    if (isFinished) return;

    if (timeLeft <= 0) {
      if (phaseIndex < PHASES.length - 1) {
        const nextIndex = phaseIndex + 1;
        setPhaseIndex(nextIndex);
        setTimeLeft(PHASES[nextIndex].duration);
      } else {
        setIsFinished(true);
      }
      return;
    }

    const timer = setTimeout(() => {
      setTimeLeft((prev) => prev - 1);
    }, 1000);

    return () => clearTimeout(timer);
  }, [timeLeft, phaseIndex, isFinished]);

  const handleSubmitDebate = async () => {
    if (!matchData || !userId || !transcript.trim()) return;

    try {
      setEnding(true);

      const res = await fetch("/api/match/end", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          matchId: matchData.matchId,
          userId,
          transcript,
        }),
      });

      const data = await res.json();

      if (!res.ok) {
        setEnding(false);
        alert(data.error || "Failed to submit debate.");
        return;
      }

      if (data.status === "completed" || data.alreadyCompleted) {
        window.location.href = `/result/${matchData.matchId}?userId=${encodeURIComponent(
          userId
        )}`;
        return;
      }

      if (data.status === "waiting") {
        setWaitingForOpponent(true);
        setEnding(false);
      }
    } catch (error) {
      console.error(error);
      setEnding(false);
      alert("Something went wrong submitting the debate.");
    }
  };

  if (loading) {
    return (
      <main className="min-h-screen bg-white px-6 py-10 text-black">
        <div className="mx-auto max-w-4xl">
          <h1 className="text-3xl font-bold">Loading match...</h1>
        </div>
      </main>
    );
  }

  if (!matchData) {
    return (
      <main className="min-h-screen bg-white px-6 py-10 text-black">
        <div className="mx-auto max-w-4xl">
          <h1 className="text-3xl font-bold">Match not found</h1>
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
  const yourSide = isPlayer1 ? matchData.player1Side : matchData.player2Side;
  const opponentUsername = isPlayer1
    ? matchData.player2Username
    : matchData.player1Username;

  const topicTitle =
    TOPICS.find((topic) => topic.id === matchData.topicId)?.title ||
    matchData.topicId;

  const totalSeconds = PHASES.reduce((sum, phase) => sum + phase.duration, 0);
  const elapsedSeconds =
    PHASES.slice(0, phaseIndex).reduce((sum, phase) => sum + phase.duration, 0) +
    (currentPhase.duration - timeLeft);
  const progress = Math.min((elapsedSeconds / totalSeconds) * 100, 100);

  return (
    <main className="min-h-screen bg-white px-6 py-10 text-black">
      <div className="mx-auto max-w-4xl">
        <div className="flex items-center justify-between gap-4">
          <div>
            <p className="text-sm uppercase tracking-wide text-gray-500">
              Match ID
            </p>
            <h1 className="text-3xl font-bold">{matchData.matchId}</h1>
          </div>

          <span className="rounded-full border px-4 py-2 text-sm font-medium">
            Ranked Match
          </span>
        </div>

        <div className="mt-8 grid gap-6 lg:grid-cols-3">
          <div className="rounded-2xl border p-6 lg:col-span-2">
            <p className="text-sm uppercase tracking-wide text-gray-500">Topic</p>
            <h2 className="mt-2 text-2xl font-semibold">{topicTitle}</h2>

            <div className="mt-6 grid gap-4 sm:grid-cols-2">
              <div className="rounded-xl bg-gray-100 p-4">
                <p className="text-sm text-gray-500">Your side</p>
                <p className="mt-1 text-xl font-semibold">{yourSide}</p>
              </div>

              <div className="rounded-xl bg-gray-100 p-4">
                <p className="text-sm text-gray-500">Opponent</p>
                <p className="mt-1 text-xl font-semibold">{opponentUsername}</p>
              </div>
            </div>

            <div className="mt-8">
              <div className="mb-2 flex items-center justify-between text-sm text-gray-600">
                <span>Match Progress</span>
                <span>{Math.round(progress)}%</span>
              </div>
              <div className="h-3 w-full rounded-full bg-gray-200">
                <div
                  className="h-3 rounded-full bg-black transition-all"
                  style={{ width: `${progress}%` }}
                />
              </div>
            </div>

            <div className="mt-8 rounded-2xl bg-black p-8 text-center text-white">
              <p className="text-sm uppercase tracking-wide opacity-70">
                Current Phase
              </p>
              <p className="mt-3 text-2xl font-semibold">
                {isFinished ? "Debate Complete" : currentPhase.label}
              </p>
              <p className="mt-4 text-6xl font-bold">
                {isFinished ? "0:00" : formatTime(timeLeft)}
              </p>
            </div>

            <div className="mt-8 rounded-xl border p-6">
              <p className="text-sm uppercase tracking-wide text-gray-500">
                Debate Transcript / Summary
              </p>
              <textarea
                value={transcript}
                onChange={(e) => setTranscript(e.target.value)}
                placeholder="Paste or write your side of the debate here..."
                className="mt-3 h-40 w-full rounded-xl border px-4 py-3 outline-none focus:border-black"
              />
            </div>

            {waitingForOpponent && (
              <div className="mt-6 rounded-xl bg-gray-100 p-4 text-sm">
                Waiting for the other debater to submit...
              </div>
            )}

            <div className="mt-8 flex flex-wrap gap-4">
              <button
                onClick={handleSubmitDebate}
                disabled={ending || waitingForOpponent || !transcript.trim()}
                className="rounded-lg bg-black px-6 py-3 text-white disabled:opacity-50"
              >
                {ending
                  ? "Submitting..."
                  : waitingForOpponent
                  ? "Waiting..."
                  : "Submit Debate"}
              </button>

              <Link
                href="/dashboard"
                className="rounded-lg border px-6 py-3 text-black"
              >
                Leave Match
              </Link>
            </div>
          </div>

          <div className="rounded-2xl border p-6">
            <p className="text-sm uppercase tracking-wide text-gray-500">
              Debate Format
            </p>

            <div className="mt-4 space-y-3">
              {PHASES.map((phase, index) => {
                const active = index === phaseIndex && !isFinished;
                const done = index < phaseIndex || isFinished;

                return (
                  <div
                    key={phase.key}
                    className={`rounded-xl border p-4 ${
                      active
                        ? "border-black bg-black text-white"
                        : done
                        ? "border-gray-300 bg-gray-100 text-gray-500"
                        : "border-gray-200 bg-white"
                    }`}
                  >
                    <p className="font-medium">{phase.label}</p>
                    <p className="mt-1 text-sm opacity-80">
                      {formatTime(phase.duration)}
                    </p>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      </div>
    </main>
  );
}