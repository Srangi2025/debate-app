"""Validated labels, grouped holdouts, and supervised chat export.

These tools do not manufacture human labels or train a model automatically.
"""
import hashlib
import json
from pathlib import Path
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, model_validator

from app.judge import JUDGE_VERSION, RUBRIC_VERSION, choose_winner, judge_messages, weighted_score
from app.schemas import DebateRequest, JudgeEvaluation, Winner


class LabelledDebate(BaseModel):
    model_config = ConfigDict(extra="forbid")
    id: str = Field(min_length=1)
    group: str = Field(min_length=1, description="Topic/source cluster; all related examples share this value")
    provenance: Literal["synthetic", "human"]
    reviewers: list[str] = Field(min_length=1)
    request: DebateRequest
    expected_winner: Winner
    evaluation: JudgeEvaluation | None = None

    @model_validator(mode="after")
    def consistent_scores(self):
        if self.evaluation:
            winner = choose_winner(weighted_score(self.evaluation.a), weighted_score(self.evaluation.b))
            if winner != self.expected_winner:
                raise ValueError("Winner label disagrees with labelled rubric scores")
        return self


def read_dataset(path: Path) -> list[LabelledDebate]:
    rows, ids, fingerprints = [], set(), set()
    for number, line in enumerate(path.read_text().splitlines(), 1):
        if not line.strip():
            continue
        try:
            row = LabelledDebate.model_validate_json(line)
            # Reject duplicates even if speakers have been swapped or case/spacing changed.
            texts = sorted(" ".join(text.lower().split()) for text in (row.request.argument_a, row.request.argument_b))
            fingerprint = hashlib.sha256(json.dumps(texts).encode()).hexdigest()
            if row.id in ids or fingerprint in fingerprints:
                raise ValueError("Duplicate ID or debate text (including swapped speakers)")
            ids.add(row.id)
            fingerprints.add(fingerprint)
            rows.append(row)
        except ValueError:
            # Do not include private debate text or Pydantic input values in the error.
            raise ValueError(f"Invalid dataset row {number}; inspect its schema, scores, and uniqueness") from None
    if not rows:
        raise ValueError("Dataset is empty")
    return rows


def grouped_split(rows: list[LabelledDebate], seed: int = 42) -> dict[str, list[LabelledDebate]]:
    groups = sorted({row.group for row in rows}, key=lambda value: hashlib.sha256(f"{seed}:{value}".encode()).hexdigest())
    if len(groups) < 3:
        raise ValueError("At least three independent topic/source groups are required")
    holdout = max(1, round(len(groups) * 0.1))
    assignments = {group: "test" if i < holdout else "valid" if i < holdout * 2 else "train" for i, group in enumerate(groups)}
    return {name: [row for row in rows if assignments[row.group] == name] for name in ("train", "valid", "test")}


def prepare(source: Path, output: Path, seed: int = 42) -> dict:
    rows = read_dataset(source)
    if any(row.provenance != "human" or row.evaluation is None for row in rows):
        raise ValueError("Training export requires human-reviewed rubric labels for every debate; synthetic smoke cases are evaluation only")
    splits = grouped_split(rows, seed)
    output.mkdir(parents=True, exist_ok=False)
    for name, items in splits.items():
        # Only train/validation chat files: held-out test labels must never be fed to SFT.
        if name != "test":
            examples = [{"messages": judge_messages(row.request) + [{"role": "assistant", "content": row.evaluation.model_dump_json()}]} for row in items]
            (output / f"{name}.jsonl").write_text("".join(json.dumps(item, ensure_ascii=False) + "\n" for item in examples))
        (output / f"{name}.labels.jsonl").write_text("".join(row.model_dump_json() + "\n" for row in items))
    manifest = {"seed": seed, "judge_version": JUDGE_VERSION, "rubric_version": RUBRIC_VERSION, "source_sha256": hashlib.sha256(source.read_bytes()).hexdigest(), "counts": {name: len(items) for name, items in splits.items()}, "groups": {name: sorted({row.group for row in items}) for name, items in splits.items()}}
    (output / "manifest.json").write_text(json.dumps(manifest, indent=2) + "\n")
    return manifest
