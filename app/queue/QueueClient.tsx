"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { authenticatedFetch, getGuestSession } from "@/lib/guest-auth";

export default function QueueClient() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [seconds, setSeconds] = useState(0);
  const [error, setError] = useState("");

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
        setError("");
        await getGuestSession();
        if (stopped) return;
        const joinRes = await authenticatedFetch("/api/queue/join", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            username,
            topics,
          }),
        });

        if (!joinRes.ok) {
          const err = await joinRes.json();
          throw new Error(err.error || "Failed to join queue.");
        }

        const joinData = await joinRes.json();
        if (stopped) return;

        if (joinData.matched && joinData.matchId) {
          router.push(`/match/${joinData.matchId}`);
          return;
        }

        // Start polling
        statusInterval = setInterval(async () => {
          if (stopped) return;

          try {
            const statusRes = await authenticatedFetch("/api/queue/status");

            if (!statusRes.ok) return;

            const statusData = await statusRes.json();
            if (stopped) return;

            if (statusData.matched && statusData.matchId) {
              if (statusInterval) clearInterval(statusInterval);
              router.push(`/match/${statusData.matchId}`);
            }
          } catch (err) {
            console.error("Status polling error:", err);
          }
        }, 2000);
      } catch (err) {
        if (!stopped) {
          setError(err instanceof Error ? err.message : "Unable to join queue.");
        }
      }
    }

    startQueue();

    return () => {
      stopped = true;
      if (statusInterval) clearInterval(statusInterval);
    };
  }, [router, topics]);

  async function handleLeave() {
    try {
      const res = await authenticatedFetch("/api/queue/leave", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({}),
      });
      if (!res.ok) throw new Error("Unable to leave queue. Please try again.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to leave queue.");
      return;
    }

    router.push("/dashboard");
  }

  return (
    <div>
      {error ? <p role="alert">{error}</p> : <p>Searching... ({seconds}s)</p>}
      <button onClick={handleLeave}>Leave</button>
    </div>
  );
}
