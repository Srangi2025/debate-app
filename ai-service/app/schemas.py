from typing import Literal
from pydantic import BaseModel, Field

Winner = Literal["A", "B", "tie"]

class DebateRequest(BaseModel):
    topic: str = Field(min_length=3, max_length=500)
    argument_a: str = Field(min_length=1, max_length=20000)
    argument_b: str = Field(min_length=1, max_length=20000)

class RubricScores(BaseModel):
    reasoning: int = Field(ge=0, le=10)
    evidence: int = Field(ge=0, le=10)
    rebuttals: int = Field(ge=0, le=10)
    relevance: int = Field(ge=0, le=10)

class JudgeEvaluation(BaseModel):
    a: RubricScores
    b: RubricScores
    explanation: str = Field(min_length=15, max_length=4000)
    strengths_a: list[str] = Field(default_factory=list, max_length=3)
    strengths_b: list[str] = Field(default_factory=list, max_length=3)
    improvements_a: list[str] = Field(default_factory=list, max_length=3)
    improvements_b: list[str] = Field(default_factory=list, max_length=3)

class DebateResult(BaseModel):
    winner: Winner
    reasoning: str
    scores: dict[str, RubricScores]
    weighted_scores: dict[str, float]
    strengths: dict[str, list[str]]
    improvements: dict[str, list[str]]
    judge_version: str
    rubric_version: str

class EloPreviewRequest(BaseModel):
    rating_a: float = Field(ge=0, le=10000)
    rating_b: float = Field(ge=0, le=10000)
    winner: Winner
    match_completed: bool = True
    account_a: bool = True
    account_b: bool = True

class EloPreview(BaseModel):
    eligible: bool
    reason: str
    current: dict[str, float]
    projected: dict[str, float]
    changes: dict[str, float]
    applied: bool = False
    updates_enabled: bool = False
