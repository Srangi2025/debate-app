"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";

function getOrCreateUserId() {
  let id = localStorage.getItem("userId");
  if (!id) {
    id = crypto.randomUUID();
    localStorage.setItem("userId", id);
  }
  return id;
}

export default function QueueClient() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [seconds, setSeconds] = useState(0);

  const topics = useMemo(() => {
    const raw = searchParams.get("topics") || "";
    return raw
      .split(",")
      .map((t) => t.trim().toLowerCase())
      .filter(Boolean);
  }, [searchParams]);

  useEffect(() => {
    const timer = setInterval(() => {
      setSeconds((s) => s + 1);
    }, 1000);

    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    if (topics.length === 0) return;

    const userId = getOrCreateUserId();
    const username = localStorage.getItem("username") || "Anonymous";

    let stopped = false;
    let statusInterval: ReturnType<typeof setInterval> | null = null;

    async function startQueue() {
      const joinRes = await fetch("/api/queue/join", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          userId,
          username,
          topics,
        }),
      });

      const joinData = await joinRes.json();

      if (joinData.matched && joinData.matchId) {
        router.push(`/match/${joinData.matchId}`);
        return;
      }

      statusInterval = setInterval(async () => {
        if (stopped) return;

        const statusRes = await fetch(`/api/queue/status?userId=${userId}`);
        const statusData = await statusRes.json();

        if (statusData.matched && statusData.matchId) {
          if (statusInterval) clearInterval(statusInterval);
          router.push(`/match/${statusData.matchId}`);
        }
      }, 2000);
    }

    startQueue();

    return () => {
      stopped = true;
      if (statusInterval) clearInterval(statusInterval);
    };
  }, [router, topics]);

  async function handleLeave() {
    const userId = localStorage.getItem("userId");
    if (!userId) {
      router.push("/dashboard");
      return;
    }

    await fetch("/api/queue/leave", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ userId }),
    });

    router.push("/dashboard");
  }

  return (
    <div>
      <p>Searching... ({seconds}s)</p>
      <button onClick={handleLeave}>Leave</button>
    </div>
  );
}