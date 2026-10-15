from __future__ import annotations

from dataclasses import dataclass, field, replace
from datetime import datetime, time
from typing import Literal, Optional

from pydantic import BaseModel, Field


@dataclass(frozen=True)
class Staff:
    id: int
    full_name: str
    role: str
    available_weekdays: tuple[int, ...] = (0, 1, 2, 3, 4)  # 0=Sunday (DB convention)
    work_start: time = time(8, 0)
    work_end: time = time(18, 0)
    slot_minutes: int = 60
    is_active: bool = True
    auth_user_id: Optional[str] = None
    base_lat: Optional[float] = None
    base_lng: Optional[float] = None


@dataclass(frozen=True)
class Booking:
    id: Optional[int]
    patient_id: str
    staff_id: int
    visit_purpose: str
    scheduled_at: datetime  # tz-aware UTC
    status: str = "scheduled"
    approval_status: str = "requested"
    workflow_status: str = "assigned"
    visit_address: Optional[str] = None
    visit_lat: Optional[float] = None
    visit_lng: Optional[float] = None
    checked_in_at: Optional[datetime] = None
    idempotency_key: Optional[str] = None
    notes: Optional[str] = None

    def with_(self, **kw) -> "Booking":
        return replace(self, **kw)


@dataclass(frozen=True)
class Identity:
    user_id: str
    is_admin: bool = False
    is_anonymous: bool = False


# ---- request/response schemas -------------------------------------------------
# Unknown fields (e.g. patient_id / staff identity) are ignored by design:
# identity comes only from the verified JWT.

class BookingRequestIn(BaseModel):
    purpose: str
    scheduled_at: datetime
    address: str = Field(min_length=3, max_length=300)
    staff_id: Optional[int] = None
    notes: Optional[str] = Field(default=None, max_length=1000)


class ReassignIn(BaseModel):
    staff_id: int


class VisitReportIn(BaseModel):
    treatment_summary: str = Field(min_length=1, max_length=5000)
    systolic_bp: Optional[int] = Field(default=None, ge=50, le=250)
    diastolic_bp: Optional[int] = Field(default=None, ge=30, le=150)
    blood_sugar: Optional[int] = Field(default=None, ge=20, le=600)
    pulse: Optional[int] = Field(default=None, ge=30, le=220)
    temperature: Optional[float] = Field(default=None, ge=30.0, le=45.0)
    oxygen_saturation: Optional[int] = Field(default=None, ge=50, le=100)
    performed_blood_draw: bool = False
    performed_injection: bool = False
    performed_infusion: bool = False
    performed_dressing_change: bool = False
    performed_catheter_change: bool = False
    patient_signature_data: Optional[str] = None


ClinicalOutcome = Literal["none", "hypoglycemia", "severe_hyperglycemia",
                         "respiratory_deterioration", "hemodynamic_deterioration"]


class ClinicalOutcomeIn(BaseModel):
    """Mirrors visit_reports_clinical_outcome_8h_check. null = not yet recorded."""
    clinical_outcome_8h: Optional[ClinicalOutcome] = None


def booking_to_dict(b: Booking, display_state: str) -> dict:
    return {
        "id": b.id,
        "patient_id": b.patient_id,
        "staff_id": b.staff_id,
        "visit_purpose": b.visit_purpose,
        "scheduled_at": b.scheduled_at.isoformat(),
        "status": b.status,
        "approval_status": b.approval_status,
        "workflow_status": b.workflow_status,
        "display_state": display_state,
        "visit_address": b.visit_address,
        "checked_in_at": b.checked_in_at.isoformat() if b.checked_in_at else None,
    }
