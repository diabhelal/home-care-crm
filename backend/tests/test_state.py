import pytest
from app.errors import DomainError
from app.state import can_transition, display_state, ensure_transition


def test_allowed_transitions():
    assert can_transition("approval_status", "requested", "confirmed")
    assert can_transition("approval_status", "requested", "rejected")
    assert can_transition("status", "scheduled", "completed")


@pytest.mark.parametrize("kind,a,b", [
    ("approval_status", "rejected", "confirmed"),
    ("approval_status", "confirmed", "requested"),
    ("status", "completed", "scheduled"),
    ("status", "cancelled", "completed"),
])
def test_illegal_transitions_409(kind, a, b):
    with pytest.raises(DomainError) as e:
        ensure_transition(kind, a, b)
    assert e.value.status == 409


@pytest.mark.parametrize("args,expected", [
    (("requested", "scheduled", "assigned", False), "requested"),
    (("confirmed", "scheduled", "assigned", False), "confirmed"),
    (("confirmed", "scheduled", "in_progress", True), "in_progress"),
    (("confirmed", "completed", "assigned", True), "completed"),
    (("confirmed", "cancelled", "assigned", False), "cancelled"),
    (("rejected", "cancelled", "assigned", False), "rejected"),
])
def test_display_state(args, expected):
    assert display_state(*args) == expected


def test_cancel_decision_rules():
    from app.state import cancel_decision
    assert cancel_decision("patient", "scheduled") == "cancel"
    assert cancel_decision("admin", "scheduled", checked_in=True) == "cancel"
    assert cancel_decision("patient", "cancelled") == "noop"
    for actor in ("patient", "admin"):
        with pytest.raises(DomainError) as e:
            cancel_decision(actor, "completed")
        assert e.value.status == 409
    with pytest.raises(DomainError):
        cancel_decision("patient", "scheduled", checked_in=True)
