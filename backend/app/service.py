from __future__ import annotations

from datetime import date, datetime, timedelta, timezone
from typing import Callable, Optional
from zoneinfo import ZoneInfo

from . import scheduling as sch
from .config import Settings
from .errors import (SlotTakenError, bad_request, conflict, forbidden,
                     not_found, slot_taken)
from .geo import Geocoder
from .models import Booking, BookingRequestIn, Identity, Staff, VisitReportIn
from .repo import Repository
from .state import cancel_decision, ensure_transition


class BookingService:
    def __init__(self, repo: Repository, settings: Settings, geocoder: Geocoder,
                 clock: Callable[[], datetime]):
        self.repo, self.cfg, self.geo, self.clock = repo, settings, geocoder, clock
        self.tz = ZoneInfo(settings.timezone)

    # ---- helpers
    def _staff_free(self, staff: Staff, at: datetime, address: Optional[str],
                    exclude_id: Optional[int] = None) -> bool:
        if not sch.is_valid_slot(staff, at, self.tz):
            return False
        pad = timedelta(minutes=self.cfg.travel_buffer_minutes + staff.slot_minutes)
        existing = self.repo.list_active_bookings(staff.id, at - pad, at + pad + timedelta(minutes=1), address)
        return not sch.conflicts(at, address, staff, existing,
                                 self.cfg.travel_buffer_minutes, exclude_id)

    def _day_load(self, staff: Staff, at: datetime) -> int:
        d = at.astimezone(self.tz).date()
        s = datetime.combine(d, datetime.min.time(), tzinfo=self.tz).astimezone(timezone.utc)
        return len(self.repo.list_active_bookings(staff.id, s, s + timedelta(days=1)))

    def _eligible(self) -> list[Staff]:
        return [s for s in self.repo.list_staff() if sch.role_eligible(s, self.cfg.eligible_roles)]

    def _require_booking(self, booking_id: int) -> Booking:
        b = self.repo.get_booking(booking_id)
        if b is None:
            raise not_found("ההזמנה לא נמצאה")
        return b

    # ---- availability
    def availability(self, start: date, end: date, staff_id: Optional[int],
                     address: Optional[str]) -> list[dict]:
        if end < start:
            raise bad_request("bad_range", "טווח תאריכים לא תקין")
        if (end - start).days >= self.cfg.max_availability_days:
            raise bad_request("range_too_large", "טווח התאריכים גדול מדי")
        if staff_id is not None:
            s = self.repo.get_staff(staff_id)
            if s is None or not s.is_active:
                raise not_found("איש הצוות לא נמצא")
            pool = [s]
        else:
            pool = self._eligible()
        now = self.clock()
        out: dict[datetime, list[int]] = {}
        d = start
        while d <= end:
            for s in pool:
                for at in sch.slots_for_day(s, d, self.tz):
                    if at > now and self._staff_free(s, at, address):
                        out.setdefault(at, []).append(s.id)
            d += timedelta(days=1)
        return [{"start": at.isoformat(), "staff_ids": sorted(ids)}
                for at, ids in sorted(out.items())]

    # ---- request
    def request_booking(self, who: Identity, body: BookingRequestIn,
                        idempotency_key: Optional[str]) -> tuple[Booking, bool]:
        if idempotency_key:
            existing = self.repo.find_by_idempotency(who.user_id, idempotency_key)
            if existing:
                return existing, False
        if body.purpose not in self.cfg.offered_purposes:
            raise bad_request("purpose_not_offered", "סוג הביקור אינו מוצע")
        at = body.scheduled_at
        if at.tzinfo is None:
            raise bad_request("naive_datetime", "נדרש אזור זמן בתאריך")
        at = at.astimezone(timezone.utc)
        if at <= self.clock():
            raise bad_request("in_past", "לא ניתן להזמין לזמן שעבר")
        coords = self.geo.geocode(body.address)
        staff = self._pick_staff(body.staff_id, at, body.address, coords)
        b = Booking(
            id=None, patient_id=who.user_id, staff_id=staff.id, visit_purpose=body.purpose,
            scheduled_at=at, status="scheduled", approval_status="requested",
            workflow_status="assigned", visit_address=body.address.strip(),
            visit_lat=coords[0] if coords else None, visit_lng=coords[1] if coords else None,
            idempotency_key=idempotency_key, notes=body.notes,
        )
        try:
            return self.repo.insert_booking(b), True
        except SlotTakenError:
            if idempotency_key:  # lost an idempotent race with ourselves
                again = self.repo.find_by_idempotency(who.user_id, idempotency_key)
                if again:
                    return again, False
            raise slot_taken()

    def _pick_staff(self, staff_id, at, address, coords) -> Staff:
        if staff_id is not None:
            s = self.repo.get_staff(staff_id)
            if s is None or not sch.role_eligible(s, self.cfg.eligible_roles):
                raise bad_request("staff_not_eligible", "איש הצוות אינו זמין להזמנה זו")
            if not self._staff_free(s, at, address):
                raise slot_taken()
            return s
        cands = [s for s in self._eligible() if self._staff_free(s, at, address)]
        if not cands:
            raise slot_taken()
        return min(cands, key=lambda s: sch.rank_key(s, coords, self._day_load(s, at)))

    # ---- admin
    def approve(self, booking_id: int) -> Booking:
        b = self._require_booking(booking_id)
        ensure_transition("approval_status", b.approval_status, "confirmed")
        if b.status != "scheduled":
            raise conflict("illegal_transition", "ההזמנה אינה פעילה")
        return self.repo.update_booking(booking_id, {"approval_status": "confirmed"})

    def reject(self, booking_id: int) -> Booking:
        b = self._require_booking(booking_id)
        ensure_transition("approval_status", b.approval_status, "rejected")
        ensure_transition("status", b.status, "cancelled")  # frees the slot
        return self.repo.update_booking(
            booking_id, {"approval_status": "rejected", "status": "cancelled"})

    def reassign(self, booking_id: int, staff_id: int) -> Booking:
        b = self._require_booking(booking_id)
        if b.status != "scheduled" or b.approval_status == "rejected":
            raise conflict("illegal_transition", "לא ניתן לשייך מחדש הזמנה זו")
        s = self.repo.get_staff(staff_id)
        if s is None or not sch.role_eligible(s, self.cfg.eligible_roles):
            raise bad_request("staff_not_eligible", "איש הצוות אינו מתאים")
        if not self._staff_free(s, b.scheduled_at, b.visit_address, exclude_id=b.id):
            raise slot_taken()
        try:
            return self.repo.update_booking(booking_id, {"staff_id": staff_id,
                                                         "workflow_status": "assigned"})
        except SlotTakenError:
            raise slot_taken()

    # ---- cancel
    def cancel_own(self, who: Identity, booking_id: int) -> Booking:
        """Patient cancels their own booking. Another patient's booking is reported as
        not found (no existence leak)."""
        b = self.repo.get_booking(booking_id)
        if b is None or b.patient_id != who.user_id:
            raise not_found("ההזמנה לא נמצאה")
        return self._cancel(b, "patient")

    def cancel_admin(self, booking_id: int) -> Booking:
        return self._cancel(self._require_booking(booking_id), "admin")

    def _cancel(self, b: Booking, actor: str) -> Booking:
        if cancel_decision(actor, b.status, b.checked_in_at is not None) == "noop":
            return b
        return self.repo.update_booking(b.id, {"status": "cancelled"})

    # ---- staff
    def _own_booking(self, staff: Staff, booking_id: int) -> Booking:
        b = self._require_booking(booking_id)
        if b.staff_id != staff.id:
            raise forbidden("ההזמנה אינה משויכת אליך")
        return b

    def check_in(self, staff: Staff, booking_id: int) -> Booking:
        b = self._own_booking(staff, booking_id)
        if b.checked_in_at is not None and b.status == "scheduled":
            return b  # idempotent
        if b.status != "scheduled" or b.approval_status != "confirmed":
            raise conflict("illegal_transition", "לא ניתן לבצע צ'ק-אין להזמנה זו")
        return self.repo.check_in(booking_id)  # timestamp = DB now(), never client

    def complete(self, staff: Staff, booking_id: int, report: VisitReportIn) -> dict:
        return self._complete(self._own_booking(staff, booking_id), report)

    def complete_admin(self, booking_id: int, report: VisitReportIn) -> dict:
        """Admin completes on behalf of the assigned staff member (the DB function allows
        owner-or-admin; the report keeps the booking's own staff_id)."""
        return self._complete(self._require_booking(booking_id), report)

    def _complete(self, b: Booking, report: VisitReportIn) -> dict:
        if b.approval_status != "confirmed":
            raise conflict("illegal_transition", "ההזמנה לא אושרה")
        ensure_transition("status", b.status, "completed")
        return self.repo.complete_visit_atomic(b.id, report.model_dump())
