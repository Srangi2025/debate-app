import asyncio
import json
from pathlib import Path
from types import SimpleNamespace

import pytest

from evaluation.dataset import LabelledDebate, grouped_split, prepare, read_dataset
from evaluation.run import evaluate
from app.schemas import JudgeEvaluation

SMOKE = Path(__file__).resolve().parents[1] / "evaluation/smoke-debates.jsonl"


def human_rows():
    rows = read_dataset(SMOKE)
    for row in rows:
        row.provenance = "human"
        row.reviewers = ["reviewer-1", "reviewer-2"]
        strong = {"reasoning": 8, "evidence": 7, "rebuttals": 8, "relevance": 8}
        weak = {"reasoning": 1, "evidence": 1, "rebuttals": 1, "relevance": 1}
        row.evaluation = JudgeEvaluation(
            a=strong if row.expected_winner != "B" else weak,
            b=strong if row.expected_winner != "A" else weak,
            explanation="Human reviewers agree on this fixture explanation.")
    return rows


def test_synthetic_fixtures_cannot_be_exported_as_human_training_data(tmp_path):
    with pytest.raises(ValueError, match="human-reviewed"):
        prepare(SMOKE, tmp_path / "training")
    assert not (tmp_path / "training").exists()


def test_duplicate_or_swapped_debates_are_rejected(tmp_path):
    row = read_dataset(SMOKE)[0].model_dump()
    other = json.loads(json.dumps(row))
    other["id"] = "different-id"
    other["request"]["argument_a"], other["request"]["argument_b"] = other["request"]["argument_b"], other["request"]["argument_a"]
    path = tmp_path / "duplicates.jsonl"
    path.write_text(json.dumps(row) + "\n" + json.dumps(other))
    with pytest.raises(ValueError, match="row 2"):
        read_dataset(path)


def test_related_groups_never_leak_into_holdouts_and_split_is_stable():
    rows = human_rows()
    related = rows[0].model_copy(update={"id": "related-example"})
    splits = grouped_split(rows + [related])
    reverse = grouped_split(list(reversed(rows + [related])))
    assert {key: {r.id for r in value} for key, value in splits.items()} == {key: {r.id for r in value} for key, value in reverse.items()}
    groups = [{row.group for row in value} for value in splits.values()]
    assert not (groups[0] & groups[1] or groups[1] & groups[2] or groups[0] & groups[2])


def test_inconsistent_winner_and_rubric_labels_are_rejected():
    row = human_rows()[0].model_dump()
    row["expected_winner"] = "B"
    with pytest.raises(ValueError, match="disagrees"):
        LabelledDebate.model_validate(row)


def test_export_uses_runtime_prompt_and_keeps_test_labels_out_of_chat_files(tmp_path):
    source = tmp_path / "labels.jsonl"
    source.write_text("".join(row.model_dump_json() + "\n" for row in human_rows()))
    output = tmp_path / "sft"
    result = prepare(source, output)
    assert result["counts"] == {"train": 1, "valid": 1, "test": 1}
    assert not (output / "test.jsonl").exists()
    assert (output / "test.labels.jsonl").exists()
    example = json.loads((output / "train.jsonl").read_text())
    assert [item["role"] for item in example["messages"]] == ["system", "user", "assistant"]
    assert "untrusted" in example["messages"][1]["content"]
    with pytest.raises(FileExistsError):
        prepare(source, output)


def test_evaluation_failures_stay_in_denominator_and_never_echo_private_text():
    async def broken(request):
        raise RuntimeError(request.argument_a)
    result = asyncio.run(evaluate(SMOKE, None, judge=broken))
    assert result["judging"]["failures"] == 3
    assert result["judging"]["winner_agreement"] == 0
    assert result["judging"]["speaker_swap_consistency"] == 0
    assert "SYSTEM OVERRIDE" not in json.dumps(result)


def test_wrong_and_unknown_claims_reduce_decision_precision(tmp_path):
    fact = json.loads((SMOKE.parent / "smoke-facts.jsonl").read_text().splitlines()[0])
    facts = tmp_path / "facts.jsonl"
    facts.write_text(json.dumps(fact))
    async def judge(request):
        return SimpleNamespace(winner="tie", scores={})
    async def live(request, **kwargs):
        return {"claims": [{"segmentId": "a-1", "quote": "A triangle has three sides.", "kind": "fact", "verdict": "contradicted", "evidence": []}, {"segmentId": "invented", "quote": "Invented", "kind": "fact", "verdict": "supported", "evidence": []}]}
    result = asyncio.run(evaluate(SMOKE, facts, judge=judge, live=live))
    assert result["facts"]["decision_precision"] == 0
    assert result["facts"]["kind_and_verdict_accuracy"] == 0
    assert result["facts"]["claim_recall"] == 1
