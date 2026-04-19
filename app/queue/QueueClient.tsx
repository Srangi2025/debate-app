"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { TOPICS } from "@/lib/topics";

type QueueState =
  | "initializing"
  | "joining"
  | "searching"
  | "matched"
  | "error";

export default function QueueClient() {
  const searchParams = useSearchParams();
  const topicParam = searchParams.get("topics") || "";

  const topicIds = useMemo(
    () =>
      topicParam
        .split(",")
        .map((id) => id.trim())
        .filter(Boolean),
    [topicParam]
  );

  const [username, setUsername] = useState<string>("");
  const [userId, setUserId] = useState<string | null>(null);
  const [status, setStatus] = useState<QueueState>("initializing");
  const [seconds, setSeconds] = useState(0);

  const [matchId, setMatchId] = useState<string | null>(null);
  const [matchTopicId, setMatchTopicId] = useState<string | null>(null);
  const [matchSide, setMatchSide] = useState<string | null>(null);
  const [opponentId, setOpponentId] = useState<string | null>(null);
  const [opponentUsername, setOpponentUsername] = useState<string | null>(null);

  const topicTitle = useMemo(() => {
    if (!matchTopicId) return "";
    const found = TOPICS.find((topic) => topic.id === matchTopicId);
    return found?.title ?? matchTopicId;
  }, [matchTopicId]);

  useEffect(() => {
    const savedUsername = localStorage.getItem("debate_username") || "";
    if (!savedUsername.trim()) {
      window.location.href = "/dashboard";
      return;
    }

    setUsername(savedUsername);

    const generatedId = `user_${Math.random().toString(36).slice(2, 10)}`;
    setUserId(generatedId);
    setStatus("joining");
  }, []);

  useEffect(() => {
    if (status !== "joining" || !userId || !username) return;

    const joinQueue = async () => {
      try {
        const res = await fetch("/api/queue/join", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            userId,
            username,
            rating: 1000,
            topicIds,
          }),
        });

        if (!res.ok) {
          setStatus("error");
          return;
        }

        setStatus("searching");
      } catch (error) {
        console.error(error);
        setStatus("error");
      }
    };

    joinQueue();
  }, [status, userId, username, topicIds]);

  useEffect(() => {
    if (status !== "searching" || !userId) return;

    const interval = setInterval(async () => {
      try {
        setSeconds((prev) => prev + 2);

        await fetch("/api/matchmake", {
          method: "POST",
        });

        const res = await fetch(
          `/api/queue/status?userId=${encodeURIComponent(userId)}`
        );

        if (!res.ok) {
          setStatus("error");
          clearInterval(interval);
          return;
        }

        const data = await res.json();

        if (data.matchFound) {
          setMatchId(data.matchId);
          setMatchTopicId(data.topicId);
          setMatchSide(data.side);
          setOpponentId(data.opponentId);
          setOpponentUsername(data.opponentUsername || data.opponentId);
          setStatus("matched");
          clearInterval(interval);
        }
      } catch (error) {
        console.error(error);
        setStatus("error");
        clearInterval(interval);
      }
    }, 2000);

    return () => clearInterval(interval);
  }, [status, userId]);

  const leaveQueue = async () => {
    if (!userId) return;

    try {
      await fetch("/api/queue/leave", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ userId }),
      });
    } catch (error) {
      console.error(error);
    }

    window.location.href = "/dashboard";
  };

  return (
    <main className="min-h-screen bg-white px-6 py-10 text-black">
      <div className="mx-auto max-w-3xl">
        <h1 className="text-4xl font-bold">Ranked Queue</h1>

        <div className="mt-8 rounded-2xl border p-6">
          <p className="text-sm text-gray-500">Username</p>
          <p className="text-lg font-semibold">{username || "Loading..."}</p>

          <div className="mt-6">
            <p className="text-sm text-gray-500">Selected Topics</p>
            <div className="mt-2 flex flex-wrap gap-2">
              {topicIds.map((topicId) => (
                <span
                  key={topicId}
                  className="rounded-full border px-3 py-1 text-sm"
                >
                  {topicId}
                </span>
              ))}
            </div>
          </div>

          <p className="mt-6 text-lg">
            {status === "initializing" && "Initializing..."}
            {status === "joining" && "Joining queue..."}
            {status === "searching" && `Searching... (${seconds}s)`}
            {status === "matched" && "Match Found!"}
            {status === "error" && "Something went wrong."}
          </p>

          {status === "matched" && (
            <div className="mt-6 rounded-xl bg-gray-100 p-4">
              <p><strong>Match ID:</strong> {matchId}</p>
              <p><strong>Topic:</strong> {topicTitle}</p>
              <p><strong>Your Side:</strong> {matchSide}</p>
              <p><strong>Opponent:</strong> {opponentUsername}</p>
            </div>
          )}

          <div className="mt-8 flex gap-4">
            {status !== "matched" ? (
              <button
                onClick={leaveQueue}
                className="rounded-lg border px-6 py-3"
              >
                Leave
              </button>
            ) : (
              <Link
                href={`/match/${matchId}?userId=${encodeURIComponent(
                  userId || ""
                )}`}
                className="rounded-lg bg-black px-6 py-3 text-white"
              >
                Enter Match
              </Link>
            )}
          </div>
        </div>
      </div>
    </main>
  );
}