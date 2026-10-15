"""Single source of truth for booking state transitions."""
from __future__ import annotations

from .errors import conflict

APPROVAL_STATES = ("requested", "confirmed", "rejected")
STATUS_STATES = ("scheduled", "completed", "cancelled")
WORKFLOW_STATES = ("unassigned", "assigned", "in_progress")

APPROVAL_TRANSITIONS: dict[str, set[str]] = {
    "requested": {"confirmed", "rejected"},
    "confirmed": set(),   # a confirmed visit is cancelled via status, not rejected
    "rejected": set(),
}
STATUS_TRANSITIONS: dict[str, set[str]] = {
    "scheduled": {"completed", "cancelled"},
    "completed": set(),
    "cancelled": set(),
}
WORKFLOW_TRANSITIONS: dict[str, set[str]] = {
    "unassigned": {"assigned"},
    "assigned": {"in_progress", "unassigned"},
    "in_progress": {"assigned"},
}

_TABLES = {
    "approval_status": APPROVAL_TRANSITIONS,
    "status": STATUS_TRANSITIONS,
    "workflow_status": WORKFLOW_TRANSITIONS,
}


def can_transition(kind: str, current: str, target: str) -> bool:
    return target in _TABLES[kind].get(current, set())


def ensure_transition(kind: str, current: str, target: str) -> None:
    if not can_transition(kind, current, target):
        raise conflict(
            "illegal_transition",
            f"מעבר לא חוקי ({kind}: {current} -> {target})",
        )


def cancel_decision(actor: str, status: str, checked_in: bool = False) -> str:
    """Cancellation rule. actor: 'patient' | 'admin'. Returns 'noop' (already cancelled,
    idempotent) or 'cancel'; raises 409 when the booking cannot be cancelled."""
    if status == "cancelled":
        return "noop"
    if status == "completed":
        raise conflict("illegal_transition", "ביקור שהושלם לא ניתן לביטול")
    ensure_transition("status", status, "cancelled")
    if actor == "patient" and checked_in:
        raise conflict("illegal_transition", "הביקור כבר החל ולא ניתן לבטלו")
    return "cancel"


def display_state(approval_status: str, status: str, workflow_status: str = "assigned",
                  checked_in: bool = False) -> str:
    """Patient-facing code: requested | confirmed | in_progress | completed |
    cancelled | rejected. (No GPS tracking exists, so 'en_route' is not emitted.)"""
    if approval_status == "rejected":
        return "rejected"
    if status == "cancelled":
        return "cancelled"
    if status == "completed":
        return "completed"
    if approval_status == "requested":
        return "requested"
    if workflow_status == "in_progress" or checked_in:
        return "in_progress"
    return "confirmed"
