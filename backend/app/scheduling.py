"""Pure scheduling logic: slots, travel buffer, eligibility, ranking."""
from __future__ import annotations

from datetime import date, datetime, timedelta, timezone
from typing import Optional
from zoneinfo import ZoneInfo

from .geo import haversine_km
from .models import Booking, Staff


def norm_address(a: Optional[str]) -> str:
    return " ".join((a or "").lower().split())


def db_weekday(d: date) -> int:
    """DB convention: 0=Sunday .. 6=Saturday. Python: Monday=0."""
    return (d.weekday() + 1) % 7


def slots_for_day(staff: Staff, day: date, tz: ZoneInfo) -> list[datetime]:
    if db_weekday(day) not in staff.available_weekdays or staff.slot_minutes <= 0:
        return []
    out = []
    cur = datetime.combine(day, staff.work_start, tzinfo=tz)
    end = datetime.combine(day, staff.work_end, tzinfo=tz)
    step = timedelta(minutes=staff.slot_minutes)
    while cur + step <= end:
        out.append(cur.astimezone(timezone.utc))
        cur += step
    return out


def is_valid_slot(staff: Staff, at: datetime, tz: ZoneInfo) -> bool:
    local = at.astimezone(tz)
    return at.astimezone(timezone.utc) in slots_for_day(staff, local.date(), tz)


def conflicts(candidate_start: datetime, candidate_address: Optional[str],
              staff: Staff, existing: list[Booking], buffer_min: int,
              exclude_id: Optional[int] = None) -> bool:
    """True if the candidate slot collides with an existing visit of this staff
    member, or leaves less than `buffer_min` travel time when the address
    differs (unknown address counts as different)."""
    dur = timedelta(minutes=staff.slot_minutes)
    buf = timedelta(minutes=buffer_min)
    cand_end = candidate_start + dur
    ca = norm_address(candidate_address)
    for b in existing:
        if b.status == "cancelled" or b.id == exclude_id:
            continue
        b_end = b.scheduled_at + dur
        if candidate_start < b_end and b.scheduled_at < cand_end:
            return True
        same = bool(ca) and ca == norm_address(b.visit_address)
        if not same and candidate_start < b_end + buf and b.scheduled_at < cand_end + buf:
            return True
    return False


def role_eligible(staff: Staff, roles: tuple[str, ...]) -> bool:
    return staff.is_active and staff.role in roles


def rank_key(staff: Staff, patient_coords: Optional[tuple[float, float]],
             day_load: int):
    if patient_coords and staff.base_lat is not None and staff.base_lng is not None:
        dist = haversine_km(patient_coords, (staff.base_lat, staff.base_lng))
    else:
        dist = float("inf")  # proximity skipped -> ties fall through to load, id
    return (dist, day_load, staff.id)
