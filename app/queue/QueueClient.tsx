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

  // Timer
  useEffect(() => {
    const timer = setInterval(() => {
      setSeconds((s) => s + 1);
    }, 1000);

    return () => clearInterval(timer);
  }, []);

  // Queue logic
  useEffect(() => {
    if (topics.length === 0) return;

    const userId = getOrCreateUserId();
    const username = (localStorage.getItem("username") || "").trim();

    if (!username) {
      alert("No username found. Please go back and enter a username.");
      router.push("/dashboard");
      return;
    }

    let stopped = false;
    let statusInterval: ReturnType<typeof setInterval> | null = null;

    async function startQueue() {
      try {
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

        if (!joinRes.ok) {
          const err = await joinRes.json();
          console.error("Join failed:", err);
          alert("Failed to join queue.");
          return;
        }

        const joinData = await joinRes.json();

        if (joinData.matched && joinData.matchId) {
          router.push(`/match/${joinData.matchId}`);
          return;
        }

        // Start polling
        statusInterval = setInterval(async () => {
          if (stopped) return;

          try {
            const statusRes = await fetch(
              `/api/queue/status?userId=${userId}`
            );

            if (!statusRes.ok) return;

            const statusData = await statusRes.json();

            if (statusData.matched && statusData.matchId) {
              if (statusInterval) clearInterval(statusInterval);
              router.push(`/match/${statusData.matchId}`);
            }
          } catch (err) {
            console.error("Status polling error:", err);
          }
        }, 2000);
      } catch (err) {
        console.error("Queue error:", err);
      }
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

    try {
      await fetch("/api/queue/leave", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ userId }),
      });
    } catch (err) {
      console.error("Leave error:", err);
    }

    router.push("/dashboard");
  }

  return (
    <div>
      <p>Searching... ({seconds}s)</p>
      <button onClick={handleLeave}>Leave</button>
    </div>
  );
}