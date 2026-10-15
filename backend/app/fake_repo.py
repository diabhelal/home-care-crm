"""In-memory repository for tests/local dev. Mimics the DB unique index."""
from __future__ import annotations

from datetime import datetime, timezone
from typing import Callable, Optional

from .errors import SlotTakenError
from .models import Booking, Staff


class FakeRepo:
    def __init__(self, staff: list[Staff] | None = None, now: Callable[[], datetime] | None = None):
        self.staff = {s.id: s for s in (staff or [])}
        self.bookings: dict[int, Booking] = {}
        self.reports: dict[int, dict] = {}
        self._next = 1
        self._now = now or (lambda: datetime.now(timezone.utc))
        self.complete_calls = 0
        self.fail_complete = False

    # staff
    def get_staff(self, staff_id): return self.staff.get(staff_id)
    def list_staff(self): return sorted(self.staff.values(), key=lambda s: s.id)

    def get_staff_by_auth_user(self, auth_user_id):
        return next((s for s in self.staff.values() if s.auth_user_id == auth_user_id), None)

    # bookings
    def get_booking(self, booking_id): return self.bookings.get(booking_id)

    def list_active_bookings(self, staff_id, start, end, address=None):
        # mirrors the DB function: other patients' addresses are never revealed; only a
        # match with the requested address is visible (as that same string)
        import dataclasses
        from .scheduling import norm_address
        out = []
        for b in self.bookings.values():
            if b.staff_id == staff_id and b.status != "cancelled" and start <= b.scheduled_at < end:
                same = bool(norm_address(address)) and norm_address(address) == norm_address(b.visit_address)
                out.append(dataclasses.replace(b, visit_address=address if same else None,
                                               visit_lat=None, visit_lng=None))
        return out

    def find_by_idempotency(self, patient_id, key):
        return next((b for b in self.bookings.values()
                     if b.patient_id == patient_id and b.idempotency_key == key), None)

    def _check_unique(self, staff_id, at, exclude=None):
        for b in self.bookings.values():
            if (b.id != exclude and b.staff_id == staff_id and b.scheduled_at == at
                    and b.status != "cancelled"):
                raise SlotTakenError()

    def insert_booking(self, booking):
        self._check_unique(booking.staff_id, booking.scheduled_at)
        saved = booking.with_(id=self._next)
        self.bookings[self._next] = saved
        self._next += 1
        return saved

    def update_booking(self, booking_id, fields):
        cur = self.bookings[booking_id]
        new = cur.with_(**fields)
        if new.status != "cancelled":
            self._check_unique(new.staff_id, new.scheduled_at, exclude=booking_id)
        self.bookings[booking_id] = new
        return new

    def check_in(self, booking_id):
        b = self.bookings[booking_id]
        if b.checked_in_at is None:
            b = b.with_(checked_in_at=self._now(), workflow_status="in_progress")
            self.bookings[booking_id] = b
        return b

    def complete_visit_atomic(self, booking_id, payload):
        self.complete_calls += 1
        if self.fail_complete:
            raise RuntimeError("simulated failure: nothing written")
        b = self.bookings[booking_id]
        report = {**payload, "id": booking_id, "booking_id": booking_id, "patient_id": b.patient_id,
                  "staff_id": b.staff_id}
        # both writes or neither (single step in memory)
        self.reports[booking_id] = report
        self.bookings[booking_id] = b.with_(status="completed", workflow_status="assigned")
        return report

    def get_visit_report(self, report_id):
        return next((r for r in self.reports.values() if r["id"] == report_id), None)

    def set_clinical_outcome(self, report_id, value):
        rep = self.get_visit_report(report_id)
        rep["clinical_outcome_8h"] = value
        return {k: rep.get(k) for k in ("id", "booking_id", "clinical_outcome_8h")}
