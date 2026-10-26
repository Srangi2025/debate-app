import asyncio
import json

import httpx
import pytest

from app.final_review import SectionReview, CondensedNotes, split_sections, section_messages, select_claims
from app.judge import evaluate_debate
from app.live_schemas import FactAssessments
from app.model_client import CONTEXT_TOKENS, fits, prompt_bound
from app.schemas import DebateRequest, JudgeEvaluation

SOURCE = {"title": "Triangle", "url": "https://en.wikipedia.org/wiki/Triangle", "text": "A triangle is a polygon with three sides and three vertices.", "provider": "Wikipedia", "retrievedAt": "2026-10-25T00:00:00Z"}


def evaluation(ids=()):
    return JudgeEvaluation(a={"reasoning": 7, "evidence": 7, "rebuttals": 6, "relevance": 8},
                           b={"reasoning": 5, "evidence": 2, "rebuttals": 4, "relevance": 8},
                           explanation="A's argument is more substantiated by the supplied evidence.", evidence_used=list(ids))


def test_full_limit_unicode_transcripts_are_partitioned_without_losing_the_tail():
    text = ("🙂 漢字 ab\n" * 3000)[:19986] + "IMPORTANT TAIL"
    assert len(text) == 20000
    sections = split_sections(text, "A debate motion", "A")
    assert "".join(sections) == text
    assert sections[-1].endswith("IMPORTANT TAIL")
    assert len(sections) > 1
    assert all(fits(section_messages("A debate motion", "A", part), SectionReview, 900) for part in sections)


def test_prompt_budget_counts_utf8_schema_and_generation_not_just_characters():
    messages = section_messages("Topic", "A", "🙂" * 20000)
    assert prompt_bound(messages, SectionReview, 900) > CONTEXT_TOKENS
    assert not fits(messages, SectionReview, 900)


def test_claim_selection_is_balanced_and_includes_late_sections():
    claims = [{"side": side, "quote": f"{side}-{i}", "section": i} for side in ("A", "B") for i in range(10)]
    assert [item["quote"] for item in select_claims(claims)] == ["A-0", "A-9", "B-0", "B-9"]


def test_max_length_debates_review_every_character_then_label_summary_based_scores():
    a = "A policy premise. " * 1200
    b = "An opposing policy premise. " * 900
    request = DebateRequest(topic="A policy motion", argument_a=a[:19994] + "TAIL-A", argument_b=b[:19994] + "TAIL-B")
    assert len(request.argument_a) == len(request.argument_b) == 20000
    seen = {"A": [], "B": []}
    async def model(messages, schema, **kwargs):
        assert fits(messages, schema, kwargs["output_tokens"])
        if schema is SectionReview:
            data = json.loads(messages[-1]["content"].split("\n", 1)[1])
            seen[data["side"]].append(data["section"])
            return SectionReview(summary="The speaker makes a policy argument with limited evidence.")
        if schema is CondensedNotes:
            return CondensedNotes(summary="A condensed policy argument with limited evidence.")
        assert "compressed reviews of ALL" in messages[-1]["content"]
        return evaluation()
    result = asyncio.run(evaluate_debate(request, model_call=model))
    assert "".join(seen["A"]) == request.argument_a
    assert "".join(seen["B"]) == request.argument_b
    assert result.review.mode == "summarized"
    assert result.review.characters == {"A": len(request.argument_a), "B": len(request.argument_b)}
    assert result.review.chunks == {side: len(parts) for side, parts in seen.items()}


def test_sources_are_fresh_checked_attributed_and_passed_into_final_scoring():
    request = DebateRequest(topic="Geometry", argument_a="A triangle has three sides.", argument_b="A triangle has four sides.")
    final_prompts = []
    async def retrieve(query):
        assert query == "triangle sides"
        return [SOURCE], "ok"
    async def model(messages, schema, **kwargs):
        if schema is SectionReview:
            data = json.loads(messages[-1]["content"].split("\n", 1)[1])
            return SectionReview(summary=data["section"], claims=[{"quote": data["section"], "kind": "fact", "query": "triangle sides"}])
        if schema is FactAssessments:
            data = json.loads(messages[-1]["content"].split("\n", 1)[1])
            return FactAssessments(checks=[{"claim_index": 0, "verdict": "supported" if "three" in data["claim"] else "contradicted", "reason": "The source states three sides.", "citations": [{"source_id": 1, "quote": SOURCE["text"]}]}])
        final_prompts.append(messages[-1]["content"])
        return evaluation(["F1", "F2"])
    result = asyncio.run(evaluate_debate(request, model_call=model, retrieve=retrieve))
    assert result.review.mode == "full"
    assert [(check.side, check.verdict) for check in result.source_checks] == [("A", "supported"), ("B", "contradicted")]
    assert "CHECKED_FACTS" in final_prompts[0] and SOURCE["text"] in final_prompts[0]
    assert result.source_checks[1].evidence[0].url == SOURCE["url"]
    assert result.evidence_used == ["F1", "F2"]


@pytest.mark.parametrize("failure", ["unavailable", "no_results", "invalid_quote", "inference_failure"])
def test_source_failures_never_become_false_verdicts_or_erase_the_debate(failure):
    request = DebateRequest(topic="Geometry", argument_a="A triangle has four sides.", argument_b="Please provide evidence.")
    async def retrieve(query):
        return ([], failure) if failure in ("unavailable", "no_results") else ([SOURCE], "ok")
    async def model(messages, schema, **kwargs):
        if schema is SectionReview:
            data = json.loads(messages[-1]["content"].split("\n", 1)[1])
            return SectionReview(summary="A claim needs evidence.", claims=[{"quote": request.argument_a, "kind": "fact", "query": "triangle"}] if data["side"] == "A" else [])
        if schema is FactAssessments:
            if failure == "inference_failure":
                raise httpx.ReadTimeout("private error")
            return FactAssessments(checks=[{"claim_index": 0, "verdict": "supported", "reason": "Invented", "citations": [{"source_id": 1, "quote": "An invented source passage."}]}])
        assert '"verdict": "unverified"' in messages[-1]["content"]
        return evaluation()
    result = asyncio.run(evaluate_debate(request, model_call=model, retrieve=retrieve))
    assert result.source_checks[0].verdict == "unverified"
    assert result.source_checks[0].evidence == []


def test_invented_claim_quotes_are_never_retrieved():
    async def model(messages, schema, **kwargs):
        if schema is SectionReview:
            return SectionReview(summary="No factual claim.", claims=[{"quote": "Never spoken", "kind": "fact", "query": "fake"}])
        return evaluation()
    async def retrieve(query):
        pytest.fail("Invented claim was sent to retrieval")
    result = asyncio.run(evaluate_debate(DebateRequest(topic="A motion", argument_a="My preference.", argument_b="I disagree."), model_call=model, retrieve=retrieve))
    assert result.source_checks == []


@pytest.mark.parametrize("kind,text", [("opinion", "I would like park entry to be free."), ("prediction", "Park admission will rise next year.")])
def test_opinions_and_predictions_are_not_sent_for_final_truth_checks(kind, text):
    async def model(messages, schema, **kwargs):
        if schema is SectionReview:
            data = json.loads(messages[-1]["content"].split("\n", 1)[1])
            return SectionReview(summary=data["section"], claims=[{"quote": data["section"], "kind": kind, "query": ""}])
        assert schema.model_json_schema()["properties"]["evidence_used"]["maxItems"] == 0
        return evaluation()
    async def retrieve(query):
        pytest.fail("Non-factual claims must not trigger final retrieval")
    result = asyncio.run(evaluate_debate(DebateRequest(topic="Park admission", argument_a=text, argument_b=text), model_call=model, retrieve=retrieve))
    assert result.source_checks == []
    assert result.review.checked_claims == 0


def test_invalid_final_evidence_ids_do_not_produce_a_saved_judgment():
    async def model(messages, schema, **kwargs):
        return SectionReview(summary="Policy discussion.") if schema is SectionReview else evaluation(["FAKE"])
    with pytest.raises(ValueError, match="invalid evidence IDs"):
        asyncio.run(evaluate_debate(DebateRequest(topic="A motion", argument_a="A preference.", argument_b="Another preference."), model_call=model))


def test_final_scoring_cannot_ignore_a_resolved_source_check():
    async def retrieve(query): return [SOURCE], "ok"
    async def model(messages, schema, **kwargs):
        if schema is SectionReview:
            data = json.loads(messages[-1]["content"].split("\n", 1)[1])
            return SectionReview(summary="A geometry claim.", claims=[{"quote": data["section"], "kind": "fact", "query": "triangle"}])
        if schema is FactAssessments:
            return FactAssessments(checks=[{"claim_index": 0, "verdict": "supported", "reason": "Three sides.", "citations": [{"source_id": 1, "quote": SOURCE["text"]}]}])
        return evaluation()
    request = DebateRequest(topic="Geometry", argument_a="A triangle has three sides.", argument_b="A triangle has three sides.")
    with pytest.raises(ValueError, match="did not account"):
        asyncio.run(evaluate_debate(request, model_call=model, retrieve=retrieve))


def test_final_evaluation_has_a_bounded_overall_deadline(monkeypatch):
    from app import judge
    monkeypatch.setattr(judge, "FINAL_TIMEOUT_SECONDS", 0.01)
    async def slow_model(*args, **kwargs):
        await asyncio.sleep(1)
        pytest.fail("Inference should have been cancelled")
    with pytest.raises(TimeoutError):
        asyncio.run(evaluate_debate(DebateRequest(topic="A motion", argument_a="A preference.", argument_b="Another preference."), model_call=slow_model))


def test_truncated_model_output_and_oversized_prompts_fail_before_scoring(monkeypatch):
    from app import model_client
    called = []
    class Client:
        def __init__(self, **kwargs): pass
        async def __aenter__(self): return self
        async def __aexit__(self, *args): pass
        async def post(self, url, json):
            called.append(json)
            return httpx.Response(200, json={"done": True, "done_reason": "length", "message": {"content": evaluation().model_dump_json()}}, request=httpx.Request("POST", url))
    monkeypatch.setattr(model_client.httpx, "AsyncClient", Client)
    with pytest.raises(ValueError, match="safe context"):
        asyncio.run(model_client.structured(section_messages("Topic", "A", "x" * 100000), SectionReview))
    assert not called
    with pytest.raises(ValueError, match="finish normally"):
        asyncio.run(model_client.structured(section_messages("Topic", "A", "A brief statement."), SectionReview))
    assert len(called) == 1
