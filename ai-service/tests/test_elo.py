from app.elo import calculate_preview
from app.schemas import EloPreviewRequest, RubricScores
from app.judge import weighted_score, choose_winner


def test_equal_rating_win():
    result = calculate_preview(EloPreviewRequest(rating_a=1200, rating_b=1200, winner="A"))
    assert result.projected == {"A": 1216, "B": 1184}
    assert result.applied is False
    assert result.updates_enabled is False


def test_tie_no_change():
    result = calculate_preview(EloPreviewRequest(rating_a=1200, rating_b=1200, winner="tie"))
    assert result.changes == {"A": 0, "B": 0}


def test_incomplete_match_is_ineligible():
    result = calculate_preview(EloPreviewRequest(rating_a=1200, rating_b=1200, winner="A", match_completed=False))
    assert result.eligible is False
    assert result.changes == {"A": 0, "B": 0}


def test_guest_is_ineligible():
    result = calculate_preview(EloPreviewRequest(rating_a=1200, rating_b=1200, winner="A", account_b=False))
    assert result.eligible is False
    assert result.changes == {"A": 0, "B": 0}


def test_weighted_judging():
    score = RubricScores(reasoning=10, evidence=0, rebuttals=0, relevance=10)
    assert weighted_score(score) == 5.0
    assert choose_winner(5.0, 5.2) == "tie"
    assert choose_winner(6.0, 5.0) == "A"
