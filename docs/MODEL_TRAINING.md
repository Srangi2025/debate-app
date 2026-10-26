# Model training and evaluation

## Current model status

The running system uses **pretrained `qwen3.5:4b` through Ollama**. No debate-specific weight training has been performed. Prompts, rubric weights, output validation, retries, and retrieved-source guards are implemented; those are application controls, not supervised training. The speech model is separately pretrained faster-whisper `base.en`.

The goals are both argument-quality judging and factual accuracy. They need separate labels and measurements. A coherent argument can contain false premises, and a correct isolated fact need not win a debate. Fine-tuning preference/rubric behavior does not supply trustworthy current facts; retrieval and evidence assessment remain necessary.

Qwen’s [model card](https://huggingface.co/Qwen/Qwen3.5-4B) describes the upstream model and license. The application uses its text interface. The exact Ollama quantization/tag digest should be recorded alongside future release reports; a tag name alone does not identify immutable weights.

## Measured baseline: 2026-10-25

A real local-model run used the committed synthetic smoke fixtures:

| Measurement | Observed result | Scope |
| --- | --- | --- |
| Winner agreement | 3/3 | Clear reasoning, symmetric tie, embedded instruction attack |
| Speaker-order consistency | 3/3 | Each debate was also evaluated with A/B swapped |
| Factual kind + verdict | 4/5 | Supported, contradicted, no evidence, opinion, prediction |
| Correct non-abstaining decisions | 2/2 | Very small frozen geometry-source examples |
| Invented citations emitted | 0 | This run only |
| Human rubric score error | Not measured | No independent human rubric labels available |

The prediction example was extracted as a factual claim and left unverified instead of being classified as a prediction. Keep this failure visible; do not tune against the smoke set and then report it as held-out accuracy. Two correct source decisions are not evidence of broad fact-checking reliability. These fixtures do not measure live retrieval recall, contested subjects, long transcripts, dialects, or political bias.

The full local report is generated under ignored `ai-service/artifacts/`; it contains case IDs, metrics, timing, versions, and dataset hashes, without raw debate text. No custom checkpoint has been produced, and there is no production accuracy percentage or approved release target yet.

## Run an evaluation

With Ollama and the configured model running, from `ai-service`:

```bash
.venv/bin/python -m evaluation.run evaluate \
  --debates evaluation/smoke-debates.jsonl \
  --facts evaluation/smoke-facts.jsonl \
  --output artifacts/baseline.json
```

Choose a fresh report path for each run; existing reports are not overwritten. Inference runs directly through the same Python functions used by the API. Fact cases inject a frozen evidence bundle while retaining the real extraction/assessment model calls. This isolates model behavior from network drift; a separate evaluation against real retrieval is still needed.

CLI commands read shell environment, not Uvicorn’s `--env-file` setting. For a different installed Ollama candidate:

```bash
JUDGE_MODEL=your-installed-candidate .venv/bin/python -m evaluation.run evaluate \
  --debates data/splits/test.labels.jsonl \
  --facts data/reviewed-facts.jsonl \
  --output artifacts/candidate-heldout.json
```

The evaluator reports winner agreement, speaker-swap consistency, inference failures, rubric mean absolute error when scores are labelled, claim recall, kind/verdict correctness, precision of factual decisions, decision coverage, and invalid quotations. Failures and missed expected claims remain in their relevant denominators. Empty denominators produce `null`, not an invented perfect score. Raw exceptions/debate text are not printed in reports. Human semantic citation-entailment review is still required.

## Collect real labels

For spreadsheet-based collection, use the [CSV templates and instructions](templates/README.md).
Upload the completed CSV files (or an Excel workbook with the same columns) for
validation and conversion into the JSONL format below.

Obtain permission to use debate material for model development. Do not assume app participation authorizes training. Keep private records under ignored `ai-service/data/`, remove identifying details, and retain source/license/consent records separately.

Have at least two independent reviewers label each debate using the same 0–10 rubric. Reviewers should be blind to model output and agree on adjudicated scores, winner/tie, supporting explanation, and uncertainty. Record reviewer disagreement before adjudication. Include a spread of topics, strong/weak arguments on both sides, short/long submissions, ties, differing styles, dialects, unsupported assertions, contradictions, and embedded instructions. Do not use the judge’s own outputs as ground truth.

One JSON object per line in the debate dataset:

```json
{"id":"reviewed-001","group":"park-admission-cluster","provenance":"human","reviewers":["reviewer-1","reviewer-2"],"request":{"topic":"Should park admission be free?","argument_a":"Free admission preserves access for residents with low incomes.","argument_b":"An entry fee could help pay for maintenance."},"expected_winner":"tie","evaluation":{"a":{"reasoning":4,"evidence":2,"rebuttals":1,"relevance":8},"b":{"reasoning":4,"evidence":2,"rebuttals":1,"relevance":8},"explanation":"Both give relevant but unsupported policy reasons and neither rebuts the other.","strengths_a":["Relevant access concern"],"strengths_b":["Relevant funding concern"],"improvements_a":["Address funding"],"improvements_b":["Address access"]}}
```

This is a **format illustration**, not an independently reviewed training example. Populate actual reviewer labels. `provenance` is a declaration, not automatic verification that reviewers did the work. `group` must encompass related topics, paraphrases, source clusters, and repeated versions so they cannot cross splits. Winner labels must agree with the deterministic weighted scores/tie band.

Fact cases follow `evaluation/smoke-facts.jsonl`: `id`, `provenance`, `request` with speaker segments, `expected` labels (`segment_id`, exact `quote`, `kind`, `verdict`), and frozen `sources` (`title`, `url`, `provider`, `retrievedAt`, `text`). Keep each case’s evidence bundle relevant to its claims; the runner supplies the same bundle to each retrieval in that case. Add human-reviewed source entailment, source quality, temporal validity, and counterevidence records. Include missing evidence, partial support, forecasts, and value judgments. Frozen-source tests alone do not evaluate search quality.

## Prepare supervised data without holdout leakage

From `ai-service`:

```bash
.venv/bin/python -m evaluation.run prepare \
  --input data/reviewed-debates.jsonl \
  --output data/splits \
  --seed 42
```

This validates labels, rejects duplicate IDs/text (including speaker swaps), refuses synthetic or unscored training rows, and splits whole topic/source groups deterministically. At least three independent groups are required for mechanics; three is far too small for a defensible accuracy study. Approximately 10% of groups each become validation and test; the remainder train. Review distributions manually because group sizes/labels can be uneven, and normalized duplicate detection does not detect semantic paraphrases.

Outputs:

- `train.jsonl` and `valid.jsonl`: supervised chat messages using the exact runtime judge prompt and human rubric JSON.
- `train.labels.jsonl`, `valid.labels.jsonl`, `test.labels.jsonl`: labelled records for benchmark comparison.
- `manifest.json`: seed, input hash, rubric/judge versions, counts, and group assignments.

There is deliberately no `test.jsonl` supervised chat file. Do not use the held-out test labels for model selection, prompt tuning, or training. The output directory must be new. The current exporter targets final rubric judging; a separate validated supervised export for claim extraction/evidence assessment is future work. Do not train the final judge on fact-case JSON in the wrong task format.

## Fine-tuning stage

Fine-tuning is pending real labelled data, hardware/runtime compatibility checks, and a held-out baseline. This repository does not automatically download another model, install training frameworks, or claim a trained adapter exists.

On Apple Silicon, MLX-LM is one possible supervised LoRA route. Its [official training guide](https://github.com/ml-explore/mlx-lm/blob/main/mlx_lm/LORA.md) documents chat JSONL, prompt masking, adapter training, and fusion. Use a separate training environment so inference dependencies remain stable. A training operator must select a **compatible** base model, verify that its tokenizer/chat template matches the serving model, and run a small memory/gradient smoke test before a full job.

Illustrative commands after that compatibility check:

```bash
# In a separate training venv; not the application's inference environment.
pip install 'mlx-lm[train]'
mlx_lm.lora --help
# Replace the placeholder with a verified-compatible Hugging Face model/local path.
mlx_lm.lora --model /path/to/compatible-base \
  --train --data data/splits --mask-prompt \
  --iters 600 --batch-size 1 --adapter-path adapters/rubric-candidate
```

The example iteration count is not an optimized training recipe. Select rank, learning rate, context length, training duration, and early stopping using validation data; record hardware, package versions, base-weight hash, dataset manifest, seeds, and loss curves. Lower training loss alone does not establish judging accuracy.

**Deployment compatibility is a separate step.** Do not assume an arbitrary MLX adapter or its GGUF export works with the current Qwen3.5 Ollama runtime. Check model-architecture support, fuse/export with compatible tooling, and validate the exact quantized serving artifact. Ollama documents model imports in its [official import guide](https://docs.ollama.com/import). No adapter import/fusion path has been validated for this project yet.

Once an exported candidate actually loads in Ollama, evaluate it using `JUDGE_MODEL` against the untouched human test split and evidence suite. Only change the deployed model after it outperforms the pretrained baseline without regressions. Keep the prior installed model for rollback.

## Release criteria to agree before training

There is no user-approved numeric accuracy target yet. Establish targets from reviewer agreement and product risk before inspecting test outcomes. Use:

- Winner/tie agreement and per-class results, rubric score error, confidence intervals, and reviewer disagreement.
- Speaker-order consistency and ideological/style/language/length slices, including ties and prompt-injection attempts.
- Factual decision precision together with coverage/abstention and extraction recall; all-unverified output must not earn a misleading accuracy score.
- Human-reviewed quote entailment, claim qualifiers, source authority, contradictory evidence, and time-sensitive facts.
- Transcription error and speaker-attribution evaluation, plus downstream judgment sensitivity to recognition errors.
- End-to-end latency, timeouts, output validity, worker recovery, and resource use under expected concurrency.

Two current release gaps are explicit: final judging does not ingest live evidence cards, and its 4,096-token context can be smaller than accepted maximum transcripts. Full-debate token budgeting/chunking and source-aware final evaluation need implementation and dedicated tests. Until then, avoid claiming the final winner is a verified factual truth assessment of every spoken claim.

Do not promote based solely on the committed smoke cases. Keep a dated model card/report listing provenance, splits, actual metrics, failure examples, serving artifact/version, and known limits for each candidate.
