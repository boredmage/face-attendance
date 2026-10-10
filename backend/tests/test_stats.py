"""Per-course exam eligibility maths (75% rule)."""
import pytest

from app.stats import exam_standing


@pytest.mark.parametrize("attended,held,eligible,to_qualify,can_miss", [
    (0, 0, True, 0, 0),    # nothing held yet
    (4, 4, True, 0, 1),    # 4/5 = 80% still fine, 4/6 is not
    (3, 4, True, 0, 0),    # exactly 75%: one more miss drops below
    (12, 12, True, 0, 4),  # 12/16 = 75%
    (2, 4, False, 4, 0),   # 6/8 = 75%
    (0, 1, False, 3, 0),   # 3/4 = 75%
    (5, 7, False, 1, 0),   # 6/8 = 75%
])
def test_exam_standing(attended, held, eligible, to_qualify, can_miss):
    s = exam_standing(attended, held)
    assert (s.eligible, s.classes_to_qualify, s.can_miss) == (eligible, to_qualify, can_miss)
