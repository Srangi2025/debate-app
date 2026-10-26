"""Run from ai-service: python -m evaluation.run --help."""
import argparse
import asyncio
from datetime import datetime, timezone
import hashlib
import json
from pathlib import Path
import time

from app.judge import MODEL, JUDGE_VERSION, RUBRIC_VERSION, evaluate_debate
from app.live_feedback import LIVE_VERSION, analyze_live
from app.live_schemas import LiveRequest
from .dataset import prepare, read_dataset


def rate(numerator, denominator):
    return round(numerator / denominator, 4) if denominator else None


async def evaluate(debates: Path, facts: Path | None, *, judge=evaluate_debate, live=analyze_live):
    rows = read_dataset(debates)
    outcomes, errors, correct, swaps, score_error, score_count = [], 0, 0, 0, 0, 0
    for row in rows:
        started = time.monotonic()
        item = {"id": row.id, "provenance": row.provenance, "expected": row.expected_winner}
        try:
            result = await judge(row.request)
            item["predicted"] = result.winner
            item["correct"] = result.winner == row.expected_winner
            correct += item["correct"]
            swapped = row.request.model_copy(update={"argument_a": row.request.argument_b, "argument_b": row.request.argument_a})
            reverse = await judge(swapped)
            item["swap_consistent"] = reverse.winner == {"A": "B", "B": "A", "tie": "tie"}[result.winner]
            swaps += item["swap_consistent"]
            if row.evaluation:
                for side, labels in (("A", row.evaluation.a), ("B", row.evaluation.b)):
                    for criterion, expected in labels.model_dump().items():
                        score_error += abs(getattr(result.scores[side], criterion) - expected)
                        score_count += 1
        except Exception as exc:
            # Record failures in the denominator; never output private inputs or raw model errors.
            errors += 1
            item["error_type"] = type(exc).__name__
        item["seconds"] = round(time.monotonic() - started, 2)
        outcomes.append(item)
    fact_results, expected_count, matched, exact, decided, correct_decided, invalid_citations, returned, expected_decided = [], 0, 0, 0, 0, 0, 0, 0, 0
    if facts:
        for line in facts.read_text().splitlines():
            if not line.strip():
                continue
            case = json.loads(line)
            expected_count += len(case["expected"])
            # A single frozen evidence bundle per case isolates model behavior from retrieval drift.
            async def retrieve(_query):
                return case["sources"], "ok" if case["sources"] else "empty"
            item = {"id": case["id"], "provenance": case["provenance"]}
            try:
                result = await live(LiveRequest.model_validate(case["request"]), retrieve=retrieve)
                returned += len(result["claims"])
                # Unmatched extracted assertions count as incorrect decisions, not silently ignored.
                for claim in result["claims"]:
                    expectations = [label for label in case["expected"] if claim["segmentId"] == label["segment_id"] and label["quote"] in claim["quote"]]
                    expected = expectations[0] if len(expectations) == 1 else None
                    if claim["verdict"] in ("supported", "contradicted", "mixed"):
                        decided += 1
                        correct_decided += bool(expected and claim["verdict"] == expected["verdict"] and claim["kind"] == expected["kind"])
                    for citation in claim["evidence"]:
                        if not any(citation["url"] == source["url"] and " ".join(citation["quote"].split()) in " ".join(source["text"].split()) for source in case["sources"]):
                            invalid_citations += 1
                labels = []
                for expected in case["expected"]:
                    found = [claim for claim in result["claims"] if claim["segmentId"] == expected["segment_id"] and expected["quote"] in claim["quote"]]
                    matched += bool(found)
                    expected_decided += len(found) == 1 and found[0]["verdict"] in ("supported", "contradicted", "mixed")
                    success = len(found) == 1 and found[0]["kind"] == expected["kind"] and found[0]["verdict"] == expected["verdict"]
                    exact += success
                    labels.append({"correct": success, "predicted_kind": found[0]["kind"] if len(found) == 1 else None, "predicted_verdict": found[0]["verdict"] if len(found) == 1 else None})
                item["checks"] = labels
            except Exception as exc:
                item["error_type"] = type(exc).__name__
            fact_results.append(item)
    return {
        "created_at": datetime.now(timezone.utc).isoformat(), "model": MODEL, "judge_version": JUDGE_VERSION, "rubric_version": RUBRIC_VERSION, "live_version": LIVE_VERSION,
        "dataset_sha256": hashlib.sha256(debates.read_bytes()).hexdigest(),
        "facts_sha256": hashlib.sha256(facts.read_bytes()).hexdigest() if facts else None,
        "warning": "Synthetic smoke fixtures do not establish human agreement or production accuracy. Frozen evidence does not test live retrieval quality.",
        "judging": {"cases": len(rows), "failures": errors, "winner_agreement": rate(correct, len(rows)), "speaker_swap_consistency": rate(swaps, len(rows)), "rubric_mae": rate(score_error, score_count)},
        "facts": {"expected_claims": expected_count, "returned_claims": returned, "claim_recall": rate(matched, expected_count), "kind_and_verdict_accuracy": rate(exact, expected_count), "decided_claims": decided, "decision_precision": rate(correct_decided, decided), "decision_coverage": rate(expected_decided, expected_count), "invalid_citations": invalid_citations},
        "debate_cases": outcomes, "fact_cases": fact_results,
    }


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    commands = parser.add_subparsers(dest="command", required=True)
    train = commands.add_parser("prepare", help="Validate human labels and export grouped supervised chat data")
    train.add_argument("--input", type=Path, required=True)
    train.add_argument("--output", type=Path, required=True)
    train.add_argument("--seed", type=int, default=42)
    check = commands.add_parser("evaluate", help="Run actual Ollama inference, including speaker swaps")
    check.add_argument("--debates", type=Path, default=Path("evaluation/smoke-debates.jsonl"))
    check.add_argument("--facts", type=Path)
    check.add_argument("--output", type=Path, required=True)
    check.add_argument("--offline-evidence", action="store_true", help="Disable final-judge network retrieval; frozen live-fact fixtures still run")
    args = parser.parse_args()
    if args.command == "prepare":
        print(json.dumps(prepare(args.input, args.output, args.seed), indent=2))
    else:
        if args.output.exists():
            parser.error("Use a new report path to preserve previous model runs")
        async def no_sources(_query):
            return [], "no_results"
        async def offline_judge(request):
            return await evaluate_debate(request, retrieve=no_sources)
        result = asyncio.run(evaluate(args.debates, args.facts, **({"judge": offline_judge} if args.offline_evidence else {})))
        result["final_evidence_mode"] = "disabled" if args.offline_evidence else "live_retrieval"
        args.output.parent.mkdir(parents=True, exist_ok=True)
        args.output.write_text(json.dumps(result, indent=2) + "\n")
        print(json.dumps({key: result[key] for key in ("model", "judging", "facts", "warning")}, indent=2))


if __name__ == "__main__":
    main()
