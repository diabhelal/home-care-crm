"""PostgREST repository. Every request carries the CALLER'S JWT, so RLS applies.

The service never uses a service_role key. `transport` is injectable so tests
exercise request construction without any network access.
"""
from __future__ import annotations

from datetime import datetime, time
from typing import Optional

import httpx

from .errors import SlotTakenError, conflict, forbidden, not_found
from .models import Booking, Staff

STAFF_COLS = ("id,full_name,role,available_weekdays,work_start_time,work_end_time,"
              "slot_duration_minutes,is_active,auth_user_id,base_lat,base_lng")


def _dt(v: Optional[str]) -> Optional[datetime]:
    return datetime.fromisoformat(v.replace("Z", "+00:00")) if v else None


def _time(v: str) -> time:
    return time.fromisoformat(v)


def staff_from_row(r: dict) -> Staff:
    return Staff(
        id=r["id"], full_name=r["full_name"], role=r["role"],
        available_weekdays=tuple(r.get("available_weekdays") or (0, 1, 2, 3, 4)),
        work_start=_time(r["work_start_time"]), work_end=_time(r["work_end_time"]),
        slot_minutes=r["slot_duration_minutes"], is_active=r.get("is_active", True),
        auth_user_id=r.get("auth_user_id"), base_lat=r.get("base_lat"), base_lng=r.get("base_lng"),
    )


def booking_from_row(r: dict) -> Booking:
    return Booking(
        id=r.get("id"), patient_id=r["patient_id"], staff_id=r["staff_id"],
        visit_purpose=r["visit_purpose"], scheduled_at=_dt(r["scheduled_at"]),
        status=r.get("status", "scheduled"),
        approval_status=r.get("approval_status", "confirmed"),
        workflow_status=r.get("workflow_status", "assigned"),
        visit_address=r.get("visit_address"), visit_lat=r.get("visit_lat"),
        visit_lng=r.get("visit_lng"), checked_in_at=_dt(r.get("checked_in_at")),
        idempotency_key=r.get("idempotency_key"), notes=r.get("notes"),
    )


def booking_to_row(b: Booking) -> dict:
    row = {
        "patient_id": b.patient_id, "staff_id": b.staff_id, "visit_purpose": b.visit_purpose,
        "scheduled_at": b.scheduled_at.isoformat(), "status": b.status,
        "approval_status": b.approval_status, "workflow_status": b.workflow_status,
        "visit_address": b.visit_address, "visit_lat": b.visit_lat, "visit_lng": b.visit_lng,
        "idempotency_key": b.idempotency_key, "notes": b.notes,
    }
    return row


class SupabaseRepo:
    def __init__(self, base_url: str, anon_key: str, jwt: str,
                 transport: httpx.BaseTransport | None = None, timeout: float = 10.0):
        self._client = httpx.Client(
            base_url=base_url.rstrip("/") + "/rest/v1",
            headers={"apikey": anon_key, "Authorization": f"Bearer {jwt}",
                     "Content-Type": "application/json"},
            transport=transport, timeout=timeout,
        )

    # -- low level
    def _raise_for(self, resp: httpx.Response):
        if resp.status_code < 400:
            return
        try:
            body = resp.json()
        except ValueError:
            body = {}
        code = body.get("code") if isinstance(body, dict) else None
        if code == "23505":
            raise SlotTakenError()
        # DB guards / RPC errors -> the same domain errors the service raises itself
        if code == "42501" or resp.status_code in (401, 403):
            raise forbidden()
        if code == "55000":
            raise conflict("illegal_transition", "מצב ההזמנה אינו מאפשר פעולה זו")
        if code == "P0002":
            raise not_found("ההזמנה לא נמצאה")
        resp.raise_for_status()

    def _get(self, path: str, params: dict) -> list[dict]:
        r = self._client.get(path, params=params)
        self._raise_for(r)
        return r.json()

    def _rpc(self, fn: str, args: dict):
        r = self._client.post(f"/rpc/{fn}", json=args)
        self._raise_for(r)
        return r.json()

    # -- staff
    def get_staff(self, staff_id):
        rows = self._get("/medical_staff", {"id": f"eq.{staff_id}", "select": STAFF_COLS})
        return staff_from_row(rows[0]) if rows else None

    def list_staff(self):
        rows = self._get("/medical_staff", {"is_active": "eq.true", "select": STAFF_COLS,
                                            "order": "id.asc"})
        return [staff_from_row(r) for r in rows]

    def get_staff_by_auth_user(self, auth_user_id):
        rows = self._get("/medical_staff", {"auth_user_id": f"eq.{auth_user_id}",
                                            "select": STAFF_COLS})
        return staff_from_row(rows[0]) if rows else None

    # -- bookings
    def get_booking(self, booking_id):
        rows = self._get("/bookings", {"id": f"eq.{booking_id}", "select": "*"})
        return booking_from_row(rows[0]) if rows else None

    def list_active_bookings(self, staff_id, start, end, address=None):
        # SECURITY DEFINER rpc (see supabase/proposed/): patients cannot read other
        # patients' bookings under RLS. It returns only times, and the requested address
        # back when a block matches it - never another patient's stored address/coords.
        rows = self._rpc("staff_busy_blocks", {
            "p_staff_id": staff_id, "p_from": start.isoformat(), "p_to": end.isoformat(),
            "p_address": address})
        return [booking_from_row({
            "patient_id": "", "staff_id": staff_id, "visit_purpose": "other", **r}) for r in rows]

    def find_by_idempotency(self, patient_id, key):
        rows = self._get("/bookings", {"patient_id": f"eq.{patient_id}",
                                       "idempotency_key": f"eq.{key}", "select": "*"})
        return booking_from_row(rows[0]) if rows else None

    def insert_booking(self, booking):
        r = self._client.post("/bookings", json=booking_to_row(booking),
                              headers={"Prefer": "return=representation"})
        self._raise_for(r)
        return booking_from_row(r.json()[0])

    def update_booking(self, booking_id, fields):
        row = {k: (v.isoformat() if isinstance(v, datetime) else v) for k, v in fields.items()}
        r = self._client.patch("/bookings", params={"id": f"eq.{booking_id}"}, json=row,
                               headers={"Prefer": "return=representation"})
        self._raise_for(r)
        rows = r.json()
        if not rows:  # RLS filtered the row out: nothing was written
            raise forbidden()
        return booking_from_row(rows[0])

    def check_in(self, booking_id):
        return booking_from_row(self._rpc("check_in_visit", {"p_booking_id": booking_id}))

    def complete_visit_atomic(self, booking_id, payload):
        return self._rpc("complete_visit", {"p_booking_id": booking_id, "p_payload": payload})
