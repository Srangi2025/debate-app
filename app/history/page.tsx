"use client";
import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { authenticatedFetch } from "@/lib/guest-auth";
import { useGuestProfile } from "@/app/components/GuestProfile";
import { TOPICS } from "@/lib/topics";

type HistoryItem = { id: string; endedAt: number; topics: string[]; player1: { username: string }; player2: { username: string }; winner: { username: string } | null };
async function fetchHistory(next?: string) {
  const response = await authenticatedFetch(`/api/history${next ? `?cursor=${encodeURIComponent(next)}` : ""}`);
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || "Unable to load history.");
  return data;
}
export default function HistoryPage() {
  const { userId, loading, kind } = useGuestProfile();
  return <main className="mx-auto w-full max-w-4xl px-6 py-10 text-black">
    <h1 className="text-3xl font-bold">Debate history</h1>
    <p className="mt-3 text-gray-600">Your completed debates, saved transcripts, and AI judgments.</p>
    {kind === "guest" && <p className="mt-3 rounded-lg bg-gray-50 p-4 text-sm">This history belongs to this browser’s guest identity. <Link href="/account" className="underline">Sign in and import it</Link> to keep it with an account.</p>}
    {loading ? <p className="mt-8" role="status">Loading your history…</p> : <HistoryList key={userId} />}
  </main>;
}

function HistoryList() {
  const [items, setItems] = useState<HistoryItem[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState("");
  const load = useCallback(async (next?: string) => {
    setLoading(true); setError("");
    try {
      const data = await fetchHistory(next);
      setItems(previous => next ? [...previous, ...data.matches.filter((item: HistoryItem) => !previous.some(existing => existing.id === item.id))] : data.matches);
      setCursor(data.nextCursor); setLoaded(true);
    } catch (err) { setError(err instanceof Error ? err.message : "Unable to load history."); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => {
    let active = true;
    void fetchHistory().then(data => { if (active) { setItems(data.matches); setCursor(data.nextCursor); setLoaded(true); } }).catch(err => { if (active) setError(err.message); });
    return () => { active = false; };
  }, []);
  return <div className="mt-8">
    <button disabled={loading} onClick={() => void load()} className="mb-5 rounded-lg border px-4 py-2 text-sm disabled:opacity-50">Refresh history</button>
    {error && <div role="alert" className="mb-4 text-red-700">{error} <button className="underline" onClick={() => void load(cursor ?? undefined)}>Retry</button></div>}
    {loaded && items.length === 0 && <p className="rounded-xl border p-6 text-gray-600">No completed debates yet. Submitted debates appear here after judging and saving finish. <Link href="/dashboard" className="underline">Find a debate</Link>.</p>}
    <div className="space-y-4">{items.map(item => <article key={item.id} className="rounded-xl border p-5">
      <h2 className="text-lg font-semibold"><Link href={`/history/${item.id}`} className="underline">{item.player1.username} vs {item.player2.username}</Link></h2>
      <p className="mt-2 text-sm text-gray-600">{item.topics.map(id => TOPICS.find(topic => topic.id === id)?.title ?? id).join(" · ")}</p>
      <p className="mt-2 text-sm">{item.winner ? `Winner: ${item.winner.username}` : "Tie"}</p>
      <time dateTime={new Date(item.endedAt).toISOString()} className="mt-2 block text-xs text-gray-500">{new Date(item.endedAt).toLocaleString()}</time>
    </article>)}</div>
    {loading && <p role="status" className="mt-4">Loading saved debates…</p>}
    {cursor && <button disabled={loading} onClick={() => void load(cursor)} className="mt-6 rounded-lg border px-4 py-2 disabled:opacity-50">Load more</button>}
  </div>;
}
