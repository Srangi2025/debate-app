"""Reviewed cases for attribution, uncertainty, and source-grounding rules."""
import asyncio
from app.live_feedback import analyze_live, validate_assessment
from app.live_schemas import LiveRequest, LiveExtraction, FactAssessment, FactAssessments

SOURCE = {
    "title": "Moon", "url": "https://en.wikipedia.org/wiki/Moon", "provider": "Wikipedia",
    "text": "The Moon is the only natural satellite of Earth.", "retrievedAt": "2026-10-25T00:00:00+00:00",
}
FEEDBACK = {key: "Not enough material to assess this criterion." for key in ["reasoning", "evidence", "rebuttals", "relevance"]}


def extraction(kind="fact", quote="Earth has two moons."):
    return LiveExtraction(summary="A claim needs evidence.", feedback_a=FEEDBACK, feedback_b=FEEDBACK,
        claims=[{"segment_id": "a-1", "quote": quote, "statement": quote, "kind": kind, "query": "Earth natural satellite"}],
        rebuttals=[])


def request(text="Earth has two moons."):
    return LiveRequest(topic="Natural satellites", segments=[{"id": "a-1", "userId": "a", "side": "A", "text": text}])


def test_valid_source_quotes_preserve_supported_and_contradicted_checks():
    for verdict in ["supported", "contradicted", "mixed"]:
        result = validate_assessment(FactAssessment(claim_index=0, verdict=verdict, reason="The cited sentence addresses the claim.",
            citations=[{"source_id": 1, "quote": SOURCE["text"]}]), [SOURCE])
        assert result[0] == verdict
        assert result[2][0]["url"] == SOURCE["url"]


def test_fabricated_quotes_and_missing_source_ids_cannot_verify_a_claim():
    for citation in [{"source_id": 1, "quote": "Earth has two moons."}, {"source_id": 6, "quote": SOURCE["text"]}]:
        verdict, _, evidence = validate_assessment(FactAssessment(claim_index=0, verdict="supported", reason="Fabricated support", citations=[citation]), [SOURCE])
        assert verdict == "unverified"
        assert evidence == []


def test_retrieval_failure_does_not_become_a_false_verdict():
    async def model(*args, **kwargs): return extraction()
    async def retrieve(query): return [], "unavailable"
    result = asyncio.run(analyze_live(request(), model_call=model, retrieve=retrieve))
    assert result["claims"][0]["verdict"] == "unverified"
    assert "could not be retrieved" in result["claims"][0]["reason"]
    assert result["claims"][0]["evidence"] == []


def test_opinions_and_predictions_never_receive_truth_labels():
    for kind in ["opinion", "prediction"]:
        async def model(*args, **kwargs): return extraction(kind=kind)
        async def retrieve(query): raise AssertionError("Non-factual claims must not trigger retrieval")
        result = asyncio.run(analyze_live(request(), model_call=model, retrieve=retrieve))
        assert result["claims"][0]["verdict"] == "not_checkable"
        assert result["claims"][0]["evidence"] == []


def test_invented_claims_and_same_side_rebuttals_are_dropped():
    item = extraction(quote="This was never spoken.")
    payload = item.model_dump()
    payload["rebuttals"] = [{"from_segment_id": "a-1", "target_segment_id": "a-1", "explanation": "Fake rebuttal"}]
    item = LiveExtraction.model_validate(payload)
    async def model(*args, **kwargs): return item
    async def retrieve(query): raise AssertionError("Invented quotes must not be searched")
    result = asyncio.run(analyze_live(request(), model_call=model, retrieve=retrieve))
    assert result["claims"] == []
    assert result["rebuttals"] == []


def test_speaker_swap_preserves_claim_verdict_and_changes_only_attribution():
    async def retrieve(query): return [SOURCE], "ok"
    async def model(prompt, schema, **kwargs):
        if schema is LiveExtraction: return extraction()
        return FactAssessments(checks=[FactAssessment(claim_index=0, verdict="contradicted", reason="The source identifies one natural satellite.", citations=[{"source_id": 1, "quote": SOURCE["text"]}])])
    first = asyncio.run(analyze_live(request(), model_call=model, retrieve=retrieve))
    swapped = request(); swapped.segments[0].side = "B"; swapped.segments[0].userId = "b"
    second = asyncio.run(analyze_live(swapped, model_call=model, retrieve=retrieve))
    assert first["claims"][0]["verdict"] == second["claims"][0]["verdict"] == "contradicted"
    assert first["claims"][0]["side"] == "A"
    assert second["claims"][0]["side"] == "B"
    assert "winner" not in first and "winner" not in second


def test_missing_assessment_and_model_check_failure_keep_claims_unverified():
    async def retrieve(query): return [SOURCE], "ok"
    async def model(prompt, schema, **kwargs):
        if schema is LiveExtraction: return extraction()
        return FactAssessments(checks=[])
    result = asyncio.run(analyze_live(request(), model_call=model, retrieve=retrieve))
    assert result["claims"][0]["verdict"] == "unverified"
