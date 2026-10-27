"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { authenticatedFetch } from "@/lib/guest-auth";
import { useGuestProfile } from "@/app/components/GuestProfile";
import { FinalEvidence } from "@/app/components/FinalEvidence";
import type { ArchivedMatch } from "@/lib/history-store";
import type { FinalSourceCheck, ReviewCoverage } from "@/lib/judge-client";

type SavedResult = { winner: { username: string } | null; judgeReason?: string; weightedScores?: { A: number; B: number }; scores?: Record<string, Record<string, number>>; sourceChecks?: FinalSourceCheck[]; evidenceUsed?: string[]; review?: ReviewCoverage; judgeVersion?: string };
export default function SavedDebatePage() {
  const { id } = useParams<{ id: string }>();
  const { userId, loading } = useGuestProfile();
  return loading ? <p role="status" className="p-8">Loading your session…</p> : <SavedDebate key={`${userId}:${id}`} id={id} />;
}
function SavedDebate({ id }: { id: string }) {
  const [data, setData] = useState<ArchivedMatch | null>(null);
  const [error, setError] = useState("");
  const [version, setVersion] = useState(0);
  useEffect(() => {
    let active = true;
    void (async () => {
      try {
        const response = await authenticatedFetch(`/api/history/${encodeURIComponent(id)}`);
        const body = await response.json();
        if (!response.ok) throw new Error(body.error || "Unable to load this debate.");
        if (active) { setData(body); setError(""); }
      } catch (err) { if (active) setError(err instanceof Error ? err.message : "Unable to load this debate."); }
    })();
    return () => { active = false; };
  }, [id, version]);
  if (error) return <main className="mx-auto max-w-3xl p-8"><p role="alert">{error}</p><button className="mt-4 underline" onClick={() => setVersion(value => value + 1)}>Retry</button><Link className="ml-4 underline" href="/history">Back to history</Link></main>;
  if (!data) return <p role="status" className="p-8">Loading saved debate…</p>;
  const result = data.result as SavedResult;
  return <main className="mx-auto w-full max-w-3xl px-6 py-10 text-black">
    <Link href="/history" className="text-sm underline">← Debate history</Link>
    <h1 className="mt-5 break-words text-3xl font-bold">{data.match.player1.username} vs {data.match.player2.username}</h1>
    <p className="mt-3 text-xl font-semibold">{result.winner ? `Winner: ${result.winner.username}` : "Tie"}</p>
    <p className="mt-3 text-gray-700">{result.judgeReason}</p>
    <div className="mt-6 grid gap-4 sm:grid-cols-2">{(["A", "B"] as const).map(side => <section key={side} className="rounded-lg border p-4">
      <h2 className="font-semibold">Side {side}: {side === "A" ? data.match.player1.username : data.match.player2.username}</h2>
      {result.weightedScores?.[side] !== undefined && <p className="mt-2">Weighted score: {result.weightedScores[side].toFixed(2)}</p>}
      {Object.entries(result.scores?.[side] ?? {}).map(([key, value]) => <p key={key} className="mt-1 text-sm capitalize">{key}: {value}</p>)}
    </section>)}</div>
    <FinalEvidence checks={result.sourceChecks} usedIds={result.evidenceUsed} review={result.review} />
    <section aria-label="Saved transcript" className="mt-8">
      <h2 className="text-2xl font-semibold">Saved transcript</h2>
      <p className="mt-2 text-sm text-gray-600">Original speaker labels are preserved when guest history is imported.</p>
      <div className="mt-4 space-y-4">{data.segments.length ? data.segments.map(segment => <article key={`${segment.userId}:${segment.id}`} className="rounded-lg bg-gray-50 p-4">
        <p className="text-sm font-semibold">Side {segment.side} · {segment.username}</p>
        <p className="mt-2 whitespace-pre-wrap break-words">{segment.text}</p>
        <p className="mt-2 text-xs text-gray-500">{segment.source === "speech" ? "Speech transcript" : "Text contribution"}</p>
      </article>) : (["A", "B"] as const).map(side => <article key={side} className="rounded-lg bg-gray-50 p-4"><h3 className="font-semibold">Submitted transcript · Side {side}</h3><p className="mt-2 whitespace-pre-wrap break-words">{data.submissions[side]}</p></article>)}</div>
    </section>
    <p className="mt-6 text-xs text-gray-500">Judge: {result.judgeVersion ?? "legacy"} · Rating updates are disabled.</p>
    <Link href={`/result/${encodeURIComponent(id)}`} className="mt-4 inline-block text-sm underline">Open full judgment</Link>
  </main>;
}
