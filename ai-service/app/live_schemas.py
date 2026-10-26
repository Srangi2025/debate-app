from typing import Literal
from pydantic import BaseModel, Field


class LiveSegment(BaseModel):
    id: str = Field(min_length=1, max_length=100)
    userId: str = Field(min_length=1, max_length=150)
    side: Literal["A", "B"]
    text: str = Field(min_length=1, max_length=2000)


class LiveRequest(BaseModel):
    topic: str = Field(min_length=1, max_length=500)
    segments: list[LiveSegment] = Field(min_length=1, max_length=40)


class SideFeedback(BaseModel):
    reasoning: str = Field(max_length=240)
    evidence: str = Field(max_length=240)
    rebuttals: str = Field(max_length=240)
    relevance: str = Field(max_length=240)


class ExtractedClaim(BaseModel):
    segment_id: str = Field(min_length=1, max_length=100)
    quote: str = Field(min_length=1, max_length=350)
    statement: str = Field(min_length=10, max_length=400, description="The full standalone assertion in a sentence. Never a classification label such as 'opinion' or 'irrelevant'.")
    kind: Literal["fact", "opinion", "prediction"] = Field(description="fact means checkable, even if FALSE or unsupported. opinion means a preference/value judgment. prediction means a future outcome.")
    query: str = Field(max_length=160, description="Neutral subject keywords for retrieving evidence about a fact. Empty for opinions or predictions.")


class ExtractedRebuttal(BaseModel):
    from_segment_id: str = Field(max_length=100)
    target_segment_id: str = Field(max_length=100)
    explanation: str = Field(max_length=350)


class LiveExtraction(BaseModel):
    summary: str = Field(max_length=650)
    feedback_a: SideFeedback
    feedback_b: SideFeedback
    claims: list[ExtractedClaim] = Field(max_length=3)
    rebuttals: list[ExtractedRebuttal] = Field(max_length=3)


class SourceQuote(BaseModel):
    source_id: int = Field(ge=1, le=6)
    quote: str = Field(min_length=1, max_length=220)


class FactAssessment(BaseModel):
    claim_index: int = Field(ge=0, le=2)
    verdict: Literal["supported", "contradicted", "mixed", "unverified"]
    reason: str = Field(max_length=500)
    citations: list[SourceQuote] = Field(max_length=2)


class FactAssessments(BaseModel):
    checks: list[FactAssessment] = Field(max_length=3)
