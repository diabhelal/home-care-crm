from __future__ import annotations

from datetime import datetime
from typing import Optional, Protocol

from .models import Booking, Staff


class Repository(Protocol):
    def get_staff(self, staff_id: int) -> Optional[Staff]: ...
    def list_staff(self) -> list[Staff]: ...
    def get_staff_by_auth_user(self, auth_user_id: str) -> Optional[Staff]: ...
    def get_booking(self, booking_id: int) -> Optional[Booking]: ...
    def list_active_bookings(self, staff_id: int, start: datetime, end: datetime,
                             address: Optional[str] = None) -> list[Booking]:
        """Non-cancelled bookings of a staff member with start in [start, end).

        `address` is the address being booked: implementations must not reveal other
        patients' addresses, only whether a block's address matches this one."""
    def find_by_idempotency(self, patient_id: str, key: str) -> Optional[Booking]: ...
    def insert_booking(self, booking: Booking) -> Booking:
        """Raises SlotTakenError on unique violation."""
    def update_booking(self, booking_id: int, fields: dict) -> Booking:
        """Raises SlotTakenError on unique violation."""
    def check_in(self, booking_id: int) -> Booking:
        """DB sets checked_in_at = now() (idempotent) and returns the booking."""
    def complete_visit_atomic(self, booking_id: int, payload: dict) -> dict:
        """ONE transaction: upsert visit_reports + bookings.status='completed'."""
    def get_visit_report(self, report_id: int) -> Optional[dict]:
        """RLS-scoped: a non-owner staff member simply does not see the row."""
    def set_clinical_outcome(self, report_id: int, value: Optional[str]) -> dict:
        """Writes ONLY clinical_outcome_8h, with the caller's JWT."""
