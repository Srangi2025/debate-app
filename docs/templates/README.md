# Human review submission templates

Fill the two CSV templates in Excel, Google Sheets, or another spreadsheet tool,
then export each as **CSV UTF-8** and upload both files in the chat. An Excel
`.xlsx` workbook with `debate-reviews` and `fact-checks` sheets using the same
columns is also suitable for review and conversion. The training CLI consumes
validated JSONL; these spreadsheets will need conversion after submission.

## debate-reviews.csv

Use one row per reviewer per debate. Give each debate a stable `debate_id` and
reuse it in the fact-check file. Use the same `topic_group` for related motions,
paraphrases, or repeated versions, so they stay together in dataset splits.

- `argument_a` and `argument_b`: complete speaker-labelled contributions in
  chronological order within each side; preserve wording and rebuttal context.
  If available, also attach a separate full interleaved transcript with speaker
  labels/timestamps for context. Do not replace the transcript with a summary.
- `reviewer_id`: a stable reviewer alias; a real name/email is not required.
- `adjudicated`: `false` for independent reviews. After reviewers resolve
  disagreements, add a consensus row with `true` and reviewer aliases joined by
  semicolons in `reviewer_id`. Preserve the independent rows.
- Eight rubric scores: integers from **0 through 10**, using reasoning, evidence,
  rebuttals, and relevance for both speakers.
- `winner`: `A`, `B`, or `tie`.
- `explanation`: specific reasons for the scores and outcome, including
  uncertainty. Add strengths and improvements for each side when possible;
  separate multiple items within a cell using semicolons.

Rubric weights are reasoning 30%, evidence 25%, rebuttals 25%, relevance 20%.
Weighted scores are rounded to two decimals; an absolute difference of at most
0.25 is a tie. If a reviewer's winner conflicts with their scores, retain the
original review and resolve the inconsistency before producing consensus labels.

## fact-checks.csv

Use one row per claim/source/reviewer. Repeat a `claim_id` when providing multiple
sources for the same claim. `debate_id` links back to its debate.

- `speaker`: `A` or `B`.
- `claim_quote`: exact text from that speaker's submission, preserving qualifiers.
- `claim_kind`: `fact`, `opinion`, or `prediction`. A false factual assertion is
  still a `fact`.
- `verdict`: `supported`, `contradicted`, `mixed`, `unverified`, or
  `not_checkable`. Use `not_checkable` for opinions/predictions. Use `unverified`
  when available evidence cannot establish the full claim.
- `source_title`, `source_url`, `source_quote`: an inspectable page and the exact
  passage relevant to the conclusion, not just a homepage link. Give each source
  its own row. Preserve the passage because websites can change.
- `retrieved_at`: retrieval date/time, preferably ISO 8601 with timezone, for
  example `2026-10-25T14:00:00Z`.
- `reason`: explain how the evidence supports/conflicts with the complete claim,
  limitations, counterevidence, and the relevant date for time-sensitive claims.

For unavailable evidence or non-checkable claims, leave source fields blank and
explain why. Do not invent a source to fill the spreadsheet.

## Before uploading

Use only material you are authorized to share for model development. Remove
unnecessary personal details. Keep reviewers' independent judgments separate
from the model's outputs. Start with a small batch so the format and rubric can
be checked before reviewing a larger collection. The first batch validates the
collection workflow; it does not establish model accuracy or guarantee enough
data for useful training.

See [the model workflow](../MODEL_TRAINING.md) for dataset splitting, evaluation,
training status, and current limitations.
