import type { FinalSourceCheck, ReviewCoverage } from "@/lib/judge-client";

export function FinalEvidence({ checks, review, usedIds = [] }: {
  checks?: FinalSourceCheck[];
  review?: ReviewCoverage;
  usedIds?: string[];
}) {
  if (!review) return null;
  return (
    <section aria-label="Final evidence and review coverage" className="mt-6 rounded-xl border p-5">
      <h2 className="font-semibold">Evidence behind this judgment</h2>
      <p className="mt-2 text-sm text-gray-700">
        {review.mode === "summarized"
          ? `All ${review.chunks.A + review.chunks.B} transcript sections were reviewed. The final score uses summaries, so details may be lost.`
          : "Both complete submitted transcripts were included in the final scoring review."}
      </p>
      <p className="mt-2 text-sm text-gray-600">
        Source checks cover selected claims, with up to two per side. Other claims remain unchecked.
        Unverified means the available evidence was insufficient; it does not mean false.
      </p>
      {!checks?.length && <p className="mt-3 text-sm text-gray-700">No checkable factual claims were selected. This judgment has no external factual verification.</p>}
      <div className="mt-4 space-y-4">
        {checks?.map(check => (
          <article key={check.id} className="rounded-lg bg-gray-50 p-4">
            <p className="text-sm font-semibold capitalize">Side {check.side} · {check.verdict}</p>
            <blockquote className="mt-2 border-l-2 border-gray-300 pl-3 text-sm">{check.quote}</blockquote>
            <p className="mt-2 text-sm text-gray-700">{check.reason}</p>
            {usedIds.includes(check.id) && <p className="mt-1 text-xs text-gray-600">Considered in the final scoring review</p>}
            {check.evidence.map((source, index) => (
              <details key={`${source.url}-${index}`} className="mt-3 rounded border bg-white p-3 text-sm">
                <summary className="cursor-pointer font-medium">Source: {source.title}</summary>
                <blockquote className="mt-2 text-gray-700">“{source.quote}”</blockquote>
                <a href={source.url} target="_blank" rel="noopener noreferrer" className="mt-2 inline-block underline">Read source</a>
                <p className="mt-1 text-xs text-gray-500">{source.provider} · Retrieved {source.retrievedAt}</p>
              </details>
            ))}
          </article>
        ))}
      </div>
      <p className="mt-4 text-xs text-gray-500">Source quality and the AI’s interpretation can still be wrong. These checks do not establish every claim as true or false.</p>
    </section>
  );
}
