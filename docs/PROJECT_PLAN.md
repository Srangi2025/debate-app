# Ranked Debate project plan

The product pairs strangers for a live debate, captures what each person said,
and uses an AI judge to explain the outcome. The current environment is a local
prototype; these milestones distinguish implemented behavior from future work.

## 1. Guest identity and matching — complete locally

- Save display names to the backend and show the saved identity across pages.
- Match distinct participants sharing a topic; prioritize the oldest eligible
  player and widen rating eligibility as they wait.
- Prevent duplicate allocations during simultaneous joins and retries.
- Support room presence, leaving, finding another opponent, and shared clocks.
- Verify video between isolated browser sessions and group sizes through 101.

## 2. Reliable AI judging — complete locally

- Atomically save a judging job with the second accepted submission.
- Process jobs outside web requests, with one evaluation at a time per worker.
- Persist retry timing, attempts, and ownership leases in Redis.
- Recover abandoned leases and prevent late workers from replacing judgments.
- Show queued, evaluating, retrying, and failed states; support explicit retries.
- Start the worker with local development and document production operation.

Acceptance: five independent jobs, duplicate workers, temporary AI outages,
worker interruption, and retry exhaustion preserve submissions and produce one
shared saved result per room. Test real Qwen and the browser result states.

Verified: seven Redis-backed judging tests, the existing 28 backend regressions,
real worker-process restart and crash recovery against a controlled AI endpoint,
the full two-browser Qwen flow, browser checks of every pending-result state,
and the production build. Redis persistence/backups and managed production
workers remain deployment work.

## 3. Capture the actual debate — complete locally

- Add speaker-labelled live transcription and save transcript segments on the
  backend, with reconnect/reload recovery.
- Show a readable live transcript and clear microphone/transcription feedback.
- Preserve a usable text fallback when speech capture is unavailable.
- Feed the recorded debate into final judging without requiring a pasted summary.

Acceptance: a two-person spoken debate produces separate attributable
transcripts, with saved text surviving reloads and brief network interruptions.

Implemented local English recognition of short microphone clips, server-assigned
speaker names/sides, a shared live transcript, and browser-persistent pending
uploads/text drafts. Explicit submission drains pending work and freezes the
server-saved contributions for judging. Text entry remains available when speech
capture cannot run. Audio in the current unfinished clip can be lost if the
browser closes abruptly; completed queued clips and saved text recover.

Verified with two isolated Chrome instances receiving different generated speech
clips: actual recognition, speaker attribution, refresh recovery, interrupted
uploads, duplicate prevention, and a completed Qwen judgment using those saved
transcripts. Backend tests cover ownership, limits, freezing, and audio encoding;
Python tests cover WAV validation and silence. This is local English capture,
not a public concurrency or multilingual accuracy certification.

## 4. Live judging and factual evidence — complete as a local prototype

- Track claims, rebuttals, and the distinction between opinions and factual claims.
- Add provisional feedback without replacing the final, versioned evaluation.
- Ground factual verification in inspectable external sources and mark uncertainty.
- Evaluate correctness and bias against a reviewed set of example debates.

Implemented periodic live coaching, attributable claim/opinion/prediction
tracking, cross-side rebuttal links, and retrieved-source checks. Claims can be
supported, contradicted, mixed, or unverified. A non-neutral verdict requires an
exact quotation from a page actually retrieved by the backend; the model cannot
invent a citation URL. Opinions/predictions do not receive truth labels.

Updates are coalesced and rate-limited, persist in Redis, and recover from worker
failure. Final judging has priority between jobs. Live feedback uses a bounded
recent transcript window (up to 40 contributions / 8,000 characters) while
retaining up to 24 earlier tracked claims. It does not overwrite final results.

Verified with real local-model geometry, satellite, and opinion examples, a
full browser flow showing source links and final judging, six Redis-backed job
tests, and seven Python guardrail cases. Those cases cover false/missing quotes,
unavailable sources, non-factual claims, attribution, and speaker swaps. This
small review does not certify broad model accuracy or freedom from bias.

The initial retrieval provider is English Wikipedia summaries, not an exhaustive
search of primary sources. Exact citations prove source provenance, not semantic
entailment; source quality and model interpretation can still be wrong. Broader
primary-source coverage and a larger reviewed evaluation corpus remain future
quality work. Checks are provisional and explicitly labelled as such in the UI.

## Model quality and repository handoff — in progress, prioritized by owner

- Document the complete local architecture, service setup, storage, API surface,
  deployment boundaries, and known model limits.
- Add actual-inference evaluation for judging, swapped speakers, and frozen-source
  fact checks, alongside labelled-data validation and grouped supervised export.
- Prepare GitHub CI and a reviewable commit; committing requires explicit owner
  approval and the owner's verified author/committer identity.
- Collect independent human rubric and evidence labels, agree on accuracy targets,
  and benchmark before training. No custom model has been trained yet.

The initial synthetic smoke run passes 3/3 winner cases and swaps, and 4/5 factual
kind/verdict cases. This is not a human accuracy benchmark. Human-labelled data,
fine-tuning/runtime compatibility, and a held-out quality benchmark remain open.
See [the model workflow](MODEL_TRAINING.md).

## 4b. AI quality improvements — complete locally; committed as 474d7f2

- Review every section of long frozen transcripts using bounded prompts; label
  summary-based final scoring and preserve original text in storage.
- Recheck selected factual claims against fresh sources for final scoring, with
  inspectable quotations and explicit uncertainty.
- Renew worker leases during longer inference and reject stale finalization.
- Add regression and real-model checks; keep changes uncommitted pending review.

Verified with 50 Node integration tests, 40 Python tests, TypeScript, lint, the
production build, real-model short/long examples, and a live-source worker/browser
flow including participant authorization and result recovery. Human-reviewed
accuracy evaluation and custom training remain open.

See [final judging details](FINAL_JUDGING.md).

## 5. History, accounts, and rankings — implemented and locally verified; live account activation pending

- Archive completed debates, frozen submissions, speaker segments, and canonical
  results to a local SQLite database through a recoverable Redis outbox.
- Add owner-filtered history pages, pagination, saved-result recovery, and backups.
- Add Supabase email/password sign-in, confirmation guidance, local sign-out, and
  explicit guest-cookie-proven history import with one-owner and active-room guards.
- Preserve original speaker identities, account names, transcripts, and evidence;
  keep rating updates disabled until model accuracy/rating rules are validated.
- Provide schema, legacy backfill, online backup/check commands, and deployment notes.

Verified locally: 68 Node tests, 40 Python tests, TypeScript, lint, production build,
and a reproducible browser flow covering Steps 1–4 plus account import/privacy,
forged tokens/IDs, active-room rejection, signup confirmation, Redis data loss,
app/worker restart, permanent-account matching/contributions, and mobile history.
Speech and AI calls used the real local
services; authentication used an isolated provider fixture and sent no email.
The compatible dependency update also resolves the npm audit findings.

The configured Supabase Auth endpoint failed DNS resolution (`ENOTFOUND`) during
the October 26, 2026 live connection check. A reachable project URL and matching
publishable key are still needed before real account login can be verified.
Cloud Redis responded successfully. The owner authorized committing and pushing
the Step 5 checkpoint; all 68 Node tests, lint, and the production build passed.
See [history/accounts setup and validation](HISTORY_AND_ACCOUNTS.md).

## 6. Public deployment and capacity — planned

- Configure TURN for browser pairs whose networks cannot establish direct WebRTC.
- Provision shared Redis, an AI service, and managed worker processes.
- Measure concurrent calls, queue delay, AI throughput, and failure recovery.
- Improve onboarding, queue feedback, accessibility, and the debate/result UI.

Local correctness tests establish behavior; they do not establish public-service
capacity or connectivity across arbitrary networks.

## GitHub checkpoints

During active work, prepare a working checkpoint about every 30 minutes and at
completed phase boundaries. State the current phase, validation results, scope,
and proposed commit message, then wait for the owner to approve or refine it
before committing and pushing. Do not create broken commits to meet the clock.
Both author and committer are Sai Rangi <srangi2025@gmail.com>; no GPT coauthor.
