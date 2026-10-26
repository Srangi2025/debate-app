"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { authenticatedFetch, getGuestSession } from "@/lib/guest-auth";

export default function QueueClient() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [seconds, setSeconds] = useState(0);
  const [error, setError] = useState("");
  const [leaving, setLeaving] = useState(false);
  const leavingRef = useRef(false);
  const pendingJoinRef = useRef<Promise<Response> | null>(null);

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

    let username = "";

    let stopped = false;
    let statusTimeout: ReturnType<typeof setTimeout> | null = null;

    async function pollStatus() {
      if (stopped || leavingRef.current) return;
      try {
        const response = await authenticatedFetch("/api/queue/status");
        const data = await response.json();
        if (stopped || leavingRef.current) return;
        if (!response.ok) throw new Error(data.error || "Unable to check queue status.");
        if (data.matched && data.matchId) {
          router.push(`/match/${data.matchId}`);
          return;
        }
        if (!data.queued) {
          await startQueue();
          return;
        }
        setError("");
      } catch (err) {
        if (stopped || leavingRef.current) return;
        setError(err instanceof Error ? err.message : "Unable to check queue status.");
      }
      if (!stopped && !leavingRef.current) statusTimeout = setTimeout(pollStatus, 2000);
    }

    async function startQueue() {
      try {
        setError("");
        await getGuestSession();
        if (stopped || leavingRef.current) return;
        if (!username) {
          const profileRes = await authenticatedFetch("/api/profile");
          const profile = await profileRes.json();
          if (stopped || leavingRef.current) return;
          if (!profileRes.ok) throw new Error(profile.error || "Unable to load your saved name.");
          if (!profile.username) { router.replace("/dashboard"); return; }
          username = profile.username;
        }
        const pendingJoin = authenticatedFetch("/api/queue/join", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            username,
            topics,
          }),
        });
        pendingJoinRef.current = pendingJoin;
        const joinRes = await pendingJoin;

        if (!joinRes.ok) {
          const err = await joinRes.json();
          throw new Error(err.error || "Failed to join queue.");
        }

        const joinData = await joinRes.json();
        if (stopped || leavingRef.current) return;

        if (joinData.matched && joinData.matchId) {
          router.push(`/match/${joinData.matchId}`);
          return;
        }

        statusTimeout = setTimeout(pollStatus, 2000);
      } catch (err) {
        if (!stopped) {
          setError(err instanceof Error ? err.message : "Unable to join queue.");
          if (!leavingRef.current) statusTimeout = setTimeout(startQueue, 3000);
        }
      }
    }

    startQueue();

    return () => {
      stopped = true;
      if (statusTimeout) clearTimeout(statusTimeout);
    };
  }, [router, topics]);

  async function handleLeave() {
    if (leavingRef.current) return;
    leavingRef.current = true;
    setLeaving(true);
    try {
      // Let an in-flight join finish before removing its queue/match records.
      await pendingJoinRef.current?.catch(() => undefined);
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
      leavingRef.current = false;
      setLeaving(false);
      return;
    }

    router.push("/dashboard");
  }

  return (
    <div>
      {error ? <p role="alert">{error}</p> : <p>Searching... ({seconds}s)</p>}
      <button disabled={leaving} onClick={handleLeave}>{leaving ? "Leaving..." : "Leave"}</button>
    </div>
  );
}
