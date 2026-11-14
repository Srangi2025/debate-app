# Local AI operation and accuracy work

The current judge is pretrained `qwen3.5:4b` served by Ollama. It has not been
custom-trained on debate outcomes. Python wraps model inference with a rubric,
source retrieval, validation, and a separate English speech model.

## Start the local pipeline

1. Start the Ollama app, or `ollama serve` if no server is already running.
   `ollama list` should include `qwen3.5:4b`. Reuse an existing server.
2. From the repository root, run `npm run ai:dev` in one terminal. This starts
   the existing Python virtual environment on `127.0.0.1:8001` and reads the
   ignored `ai-service/.env` if present. Follow README setup if the venv is absent.
3. Run `npm run dev` in another terminal for the website and judging worker.
4. Run `npm run ai:check` to inspect API/model configuration and speech loading.
   Health responses alone do not prove that model inference works. The speech
   model loads on its first non-silent audio request.

Keep these terminals running during local debates. Closing Python leaves Ollama
available but makes the app's judging/transcription API unavailable. Closing the
worker stops queued judging even while Python and Ollama are healthy.

November 3 recovery verified: existing Ollama model on GPU, real judging/swap
inference, successful HTTP speech recognition of a generated WAV clip, live
Wikipedia retrieval (three sources), and worker heartbeat. Local AI restart does
not provision an always-on backend for Vercel. The Python API remains loopback-only
and was not externally hosted. Server-to-server bearer authentication has since
been implemented; set `AI_REQUIRE_AUTH=true` and `AI_SERVICE_TOKEN` before any
remote exposure. External hosting remains Step 6. See the
[zero-budget hosting options](FREE_HOSTING.md).

## Evaluate before claiming quality improvements

From `ai-service`, run the committed synthetic regression cases:

```bash
.venv/bin/python -m evaluation.run evaluate \
  --facts evaluation/smoke-facts.jsonl --offline-evidence \
  --output artifacts/new-baseline.json
```

Use a new output path each time. Reports preserve failures in denominators and
record model digest/details, final/live context settings, versions, and dataset
hashes. CLI progress reports completed case counts without printing transcripts.
`--offline-evidence` disables final-judge live retrieval; fact cases always use
their supplied frozen sources. `--facts-only` skips debate inference and reports
empty debate metrics as `null` rather than a perfect score.

For a combined fact regression run:

```bash
mkdir -p artifacts
cat evaluation/smoke-facts.jsonl evaluation/evidence-challenges.jsonl \
  evaluation/temporal-challenges.jsonl > artifacts/combined-facts.jsonl
.venv/bin/python -m evaluation.run evaluate \
  --facts artifacts/combined-facts.jsonl --facts-only \
  --output artifacts/new-fact-regression.json
```

The additional synthetic cases cover missing cost measurements, stale years,
numerical contradiction, hostile source instructions, policy preferences, and
the distinction between announcing a plan and predicting its completion. Their
fictional sources use `example.org` and are injected into the evaluator; they
are not fetched or presented as real-world evidence.

The restored baseline passed all three winner cases and speaker swaps, but only
four of five factual-kind/verdict cases. It classified a future prediction as a
fact, leaving it unverified. Live evidence v2 clarifies temporal classification
before retrieval and rejects unfinished/truncated model responses even when
their JSON passes schema validation. The old report remains preserved.

This prompt was informed by the smoke failure, so subsequent smoke performance
is regression evidence, not an independent held-out accuracy estimate. These
small synthetic examples do not establish human agreement, source entailment,
political fairness, or factual coverage across topics. Exact quotations prove
provenance, not that the quotation establishes the entire claim.

The v2 follow-up passed all 12 combined factual-kind/verdict cases, including the
previous prediction failure and both announcement/fulfillment examples. All 12
expected claims were extracted; five received source-backed decisions and no
invalid citations were emitted. This is a synthetic regression result, not a
population accuracy estimate. The restored final-judge baseline remained 3/3
winner cases and 3/3 speaker-order checks; final scoring prompts were unchanged.
All 42 Python behavior tests and lint passed. Raw reports stay under ignored
`ai-service/artifacts/`.

## Next quality milestone

Collect independent human rubric/evidence labels using the existing templates;
agree on targets, preserve topic/source groups in held-out splits, and measure
the pretrained baseline before training or changing the serving model. Broader
primary-source retrieval is still open; the current retriever uses Wikipedia
summaries. See [the model workflow](MODEL_TRAINING.md).
