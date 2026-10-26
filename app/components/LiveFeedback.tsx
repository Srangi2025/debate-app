"use client";

import { useEffect, useState } from "react";
import { authenticatedFetch } from "@/lib/guest-auth";
import type { FactClaim, LiveSnapshot, LiveState } from "@/lib/live-feedback";
import type { TranscriptSegment } from "@/lib/transcript";

const labels: Record<FactClaim["verdict"], string> = {
  supported: "Source supports", contradicted: "Source contradicts", mixed: "Mixed evidence",
  unverified: "Unverified", not_checkable: "Not a factual check",
};

export function LiveFeedback({ matchId, segments }: { matchId: string; segments: TranscriptSegment[] }) {
  const [snapshot, setSnapshot] = useState<LiveSnapshot | null>(null);
  const [state, setState] = useState<LiveState | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;
    let fetching = false;
    const refresh = async () => {
      if (!active || fetching) return;
      fetching = true;
      try {
        const response = await authenticatedFetch(`/api/match/${matchId}/feedback`, { signal: AbortSignal.timeout(8000) });
        const data = await response.json();
        if (!active) return;
        if (!response.ok) throw new Error(data.error || "Unable to refresh live feedback.");
        setSnapshot(data.snapshot); setState(data.state); setError("");
      } catch (err) {
        if (active) setError(err instanceof Error ? err.message : "Live feedback is temporarily unavailable.");
      } finally { fetching = false; }
    };
    void refresh();
    const timer = setInterval(refresh, 5000);
    return () => { active = false; clearInterval(timer); };
  }, [matchId]);

  const byId = new Map(segments.map(segment => [segment.id, segment]));
  const name = (side: "A" | "B") => segments.find(segment => segment.side === side)?.username ?? `Side ${side}`;
  const status = state?.status === "analyzing" ? "Updating feedback..."
    : state?.status === "retrying" ? "Update will retry automatically"
    : state?.status === "queued" ? "Update queued"
    : snapshot ? "Feedback saved" : "Waiting for contributions";

  return (
    <section aria-labelledby="live-feedback-title" className="mt-6 rounded-xl border border-blue-200 bg-blue-50/40 p-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 id="live-feedback-title" className="text-xl font-semibold">Live AI feedback</h2>
        <span className="rounded-full bg-blue-100 px-3 py-1 text-xs font-medium text-blue-900">Provisional</span>
      </div>
      <p role="status" className="mt-2 text-sm text-gray-600">{status}</p>
      <p className="mt-2 text-xs text-gray-600">Feedback updates periodically from saved contributions. The final result uses the full submitted debate. Fact checks currently use Wikipedia summaries and may be incomplete.</p>
      {(error || state?.error) && <p role="status" className="mt-3 text-sm text-amber-900">{error || state?.error}</p>}
      {!snapshot && <p className="mt-4 text-sm text-gray-600">Speak or send text to receive feedback on reasoning, evidence, rebuttals, and relevance.</p>}
      {snapshot && <>
        <p className="mt-4 text-sm text-gray-900">{snapshot.summary}</p>
        <p className="mt-2 text-xs text-gray-500">Recent text through contribution #{snapshot.revision} · Updated {new Date(snapshot.updatedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</p>
        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          {(["A", "B"] as const).map(side => <div key={side} className="rounded-lg border bg-white p-4">
            <h3 className="font-semibold">{name(side)} · Side {side}</h3>
            <dl className="mt-3 space-y-3 text-sm">
              {(["reasoning", "evidence", "rebuttals", "relevance"] as const).map(criterion => <div key={criterion}>
                <dt className="font-medium capitalize">{criterion}</dt>
                <dd className="mt-1 text-gray-600">{snapshot.feedback[side][criterion]}</dd>
              </div>)}
            </dl>
          </div>)}
        </div>
        <h3 className="mt-5 font-semibold">Tracked claims</h3>
        <div className="mt-3 max-h-96 space-y-3 overflow-y-auto">
          {!snapshot.claims.length && <p className="text-sm text-gray-600">No attributable claims were extracted from this update.</p>}
          {snapshot.claims.slice().reverse().map(claim => <article key={claim.id} className="rounded-lg border bg-white p-4">
            <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
              <p className="font-semibold text-gray-600">{name(claim.side)} · {claim.kind}</p>
              <span className={`rounded-full px-2 py-1 font-medium ${claim.verdict === "supported" ? "bg-emerald-100 text-emerald-900" : claim.verdict === "contradicted" ? "bg-rose-100 text-rose-900" : claim.verdict === "mixed" ? "bg-amber-100 text-amber-900" : "bg-gray-100 text-gray-700"}`}>
                {labels[claim.verdict]}
              </span>
            </div>
            <blockquote className="mt-2 border-l-2 pl-3 text-sm text-gray-900">“{claim.quote}”</blockquote>
            <p className="mt-2 text-sm text-gray-600">{claim.reason}</p>
            {claim.evidence.map((source, index) => <details key={`${source.url}:${index}`} className="mt-3 rounded border border-gray-200 p-3 text-sm">
              <summary className="cursor-pointer font-medium">{source.title} · {source.provider}</summary>
              <blockquote className="mt-2 text-gray-700">“{source.quote}”</blockquote>
              <a href={source.url} target="_blank" rel="noopener noreferrer" className="mt-2 inline-block text-blue-800 underline">Open retrieved source ↗</a>
              <p className="mt-1 text-xs text-gray-500">Retrieved {new Date(source.retrievedAt).toLocaleString()}</p>
            </details>)}
          </article>)}
        </div>
        {!!snapshot.rebuttals.length && <>
          <h3 className="mt-5 font-semibold">Rebuttals detected</h3>
          <div className="mt-3 space-y-2">
            {snapshot.rebuttals.map((item, index) => <div key={`${item.fromSegmentId}:${item.targetSegmentId}:${index}`} className="rounded-lg border bg-white p-3 text-sm">
              <p className="font-medium">{name(item.fromSide)} responded to {name(item.targetSide)}</p>
              <p className="mt-1 text-gray-600">{item.explanation}</p>
              {byId.has(item.targetSegmentId) && <p className="mt-2 text-xs text-gray-500">Responding to: “{byId.get(item.targetSegmentId)?.text.slice(0, 180)}”</p>}
            </div>)}
          </div>
        </>}
      </>}
    </section>
  );
}
