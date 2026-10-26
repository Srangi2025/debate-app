# Final judging: long transcripts and checked evidence

Phase: **4b — AI quality improvements, before history/accounts**.
Implementation version: `ollama-grounded-v2`; rubric: `debate-rubric-v1`.
No custom model training has been performed.

## What changed

Previously the judge received both submitted transcripts in one fixed
4,096-token call, without retrieved evidence. The new pipeline inspects every
section, rechecks selected factual claims, and includes checked verdicts and
actual source quotations in the final rubric input. Frozen submissions stay
unchanged in Redis.

1. Partition each speaker's submitted text into consecutive bounded sections.
   Concatenating the sections reproduces the entire original text, including
   its ending and Unicode characters.
2. Review each section for reasoning, evidence, concessions, and rebuttals;
   classify up to two candidate assertions as facts, opinions, or predictions, with
   exact transcript quotations. Only facts with a search query proceed. Reject
   invented quotations before retrieval.
3. Select at most two distinct candidates per speaker, using the first and last
   candidate to include material beyond the beginning. This is bounded coverage,
   not an exhaustive assessment of every factual claim.
4. Retrieve fresh English Wikipedia summaries using neutral model-proposed
   search terms. Do not trust cached live feedback as final ground truth, and
   never fetch a model-proposed URL.
5. Assess each selected claim against its retrieved extracts. A resolved label
   requires valid source IDs and an actual contiguous source quotation. Source
   outages, invalid quotes, and failed checks remain **unverified**, not false.
6. If the complete transcripts and checked evidence fit, use both transcripts
   verbatim for final scoring. Otherwise compress all section-review notes into
   bounded per-speaker summaries, then use those summaries plus checked evidence.
7. Validate rubric output and evidence IDs. Every resolved check must appear in
   `evidence_used`; the final model schema makes this field required. Irrelevant
   checked claims must still be considered without automatically changing scores.
   The server computes weighted totals and winner/tie. The Node
   client independently verifies the arithmetic, winner, and evidence structure.
8. Atomically save the outcome, coverage metadata, and source cards under the
   current job lease. Both participants receive the same saved result.

## Context budgets and limits

`JUDGE_CONTEXT_TOKENS` defaults to **16,384**, configurable between 8,192 and
65,536. Increasing it increases model memory requirements; see Ollama's
[context documentation](https://docs.ollama.com/context-length). It configures
each final-judge model call, not the separate live-feedback pipeline.

The budget uses serialized UTF-8 bytes as a conservative token bound for the
current Qwen byte-level tokenizer, plus schema size, reserved output tokens,
and 1,024 tokens of template headroom. This is intentionally conservative, not
an exact token count or a guarantee for arbitrary replacement tokenizers.
Revalidate budgeting when changing model families or templates.

Every raw section is at most 6,000 UTF-8 bytes and must independently fit its
schema/output allowance. Repeated compression is bounded and must make progress.
The final call is checked again after adding evidence. Oversized prompts or
generation that does not finish normally fail rather than saving a potentially
truncated judgment. Inspect Ollama's [chat API](https://docs.ollama.com/api/chat)
for response completion metadata.

The existing input limits remain 20,000 characters per speaker. A Python
evaluation has a ten-minute overall deadline and 90-second individual inference
timeouts; the Node HTTP request allows 620 seconds. Failed evaluations leave
the original submissions available for the existing retry workflow.

## Job ownership

Final jobs retain a four-minute lease. While inference runs, the owning worker
renews it every minute using a Redis operation that checks both job token and
lock token. Only that owner can extend the lock and scheduled retry time.

If renewal fails or ownership changes, the worker aborts its HTTP request and
will not finalize. A stopped worker ceases renewal, so another process can
recover the job after the last lease expires. Finalization and settlement retain
their existing token checks. Aborting an HTTP connection does not guarantee the
remote service stops immediately; the Python deadline still bounds that work.

## Result contract and display

Python adds:

- `source_checks`: claim ID, speaker, exact transcript quote, verdict, reason,
  and validated source cards including URL, quote, provider, and retrieval time.
- `evidence_used`: IDs considered in final scoring, validated against the checks.
- `review`: full/summarized mode, input character counts, section counts, context
  size, candidate/checked claim counts, and explicit limitations.

Redis finalization also keeps the validated model JSON as an internal canonical
snapshot, because Lua cjson converts empty arrays into objects. The API restores
the canonical arrays and omits this duplicate internal payload.

API results expose the public fields as `sourceChecks`, `evidenceUsed`, and `review`.
The result page shows coverage and expandable source quotations. Summary-based
scores carry a visible warning. Older saved results without these fields still
render. Rating updates remain disabled.

## Verification and limits

Regression coverage includes maximum-length/Unicode partitioning, final source
attribution, missing/invalid evidence, malformed evidence IDs, ignored resolved
checks, truncated output, deadlines, owned/stale renewal, and saved result fields.
The final regression run passed **50 Node integration tests and 40 Python tests**,
plus TypeScript checking, lint, and the production build. Application tests do
not prove model accuracy.

The real local Qwen model also completed a short synthetic geometry debate and
a roughly 39,855-character debate with decisive factual claims at the end. The
long case used eight sections and summary-based scoring; both included actual
quotations from frozen fixture evidence and labelled the false assertion as
contradicted. These are targeted smoke tests, not independently human-reviewed
accuracy estimates. Local generated reports are ignored under
`ai-service/artifacts/`.

A full worker-to-browser check also used live Wikipedia retrieval, processed a
long debate across eight sections, saved speaker-attributed supported/contradicted
checks, and displayed source quotations on the result page. The targeted run
took about 46 seconds on this development machine. Both participants received
the same evidence; a third guest received HTTP 403. Refresh, mobile layout,
unverified evidence, and no-claim result states were checked separately. This is
a small integration check, not a throughput or accuracy benchmark. An actual
API check of an opinion-only debate also selected zero factual claims and
returned empty evidence arrays successfully.

Summary compression can lose qualifications or rebuttal details. Claim selection
may miss the most important assertion. Exact quotation matching establishes
provenance, not entailment, source quality, or absence of bias. English Wikipedia
summaries provide limited coverage and may be stale or incomplete. Independent
human-labelled evaluation, broader source coverage, and training remain future
quality work; see [the model workflow](MODEL_TRAINING.md).
