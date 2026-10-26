"""Pure Elo calculation. Does not read from or write to a database."""
from .schemas import EloPreview, EloPreviewRequest

K_FACTOR = 32.0


def calculate_preview(request: EloPreviewRequest) -> EloPreview:
    current = {"A": request.rating_a, "B": request.rating_b}
    reason = "Eligible for future rating update"
    eligible = True
    if not request.match_completed:
        eligible, reason = False, "Match is incomplete"
    elif not (request.account_a and request.account_b):
        eligible, reason = False, "Both participants must have permanent accounts"

    projected = current.copy()
    if eligible:
        expected_a = 1 / (1 + 10 ** ((request.rating_b - request.rating_a) / 400))
        actual_a = {"A": 1.0, "B": 0.0, "tie": 0.5}[request.winner]
        delta = K_FACTOR * (actual_a - expected_a)
        projected = {
            "A": round(request.rating_a + delta, 2),
            "B": round(request.rating_b - delta, 2),
        }

    return EloPreview(
        eligible=eligible,
        reason=reason,
        current=current,
        projected=projected,
        changes={side: round(projected[side] - current[side], 2) for side in current},
    )
