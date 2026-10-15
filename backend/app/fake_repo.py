"""In-memory repository for tests/local dev. Mimics the DB unique index."""
from __future__ import annotations

from datetime import datetime, timezone
from typing import Callable, Optional

from .errors import SlotTakenError
from .models import Booking, Staff
from .risk import VITAL_KEYS, verify_attestation


class FakeRepo:
    def __init__(self, staff: list[Staff] | None = None, now: Callable[[], datetime] | None = None):
        self.staff = {s.id: s for s in (staff or [])}
        self.bookings: dict[int, Booking] = {}
        self.reports: dict[int, dict] = {}
        self._next = 1
        self._now = now or (lambda: datetime.now(timezone.utc))
        self.complete_calls = 0
        self.fail_complete = False
        # clinical (see app/risk.py)
        self.patients: dict[str, dict] = {}
        self.predictions: list[dict] = []
        self.alerts: list[dict] = []
        self.attestation_secret: str | None = None
        self.fail_record = False

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

    # ---- clinical risk orchestration
    def get_report_for_risk(self, report_id):
        return self.get_visit_report(report_id)

    def get_patient_risk_context(self, patient_id):
        return self.patients.get(patient_id)

    def _vit(self, r):
        return {k: r.get(k) for k in VITAL_KEYS}

    def get_previous_report(self, patient_id, exclude_report_id):
        rows = [r for r in self.reports.values()
                if r["patient_id"] == patient_id and r["id"] != exclude_report_id]
        rows.sort(key=lambda r: r.get("visit_date") or "", reverse=True)
        return self._vit(rows[0]) if rows else None

    def list_patient_reports(self, patient_id):
        rows = [r for r in self.reports.values() if r["patient_id"] == patient_id]
        rows.sort(key=lambda r: r.get("visit_date") or "")
        return [{"visit_date": r.get("visit_date"), **self._vit(r)} for r in rows]

    def _insert_alert(self, patient_id, pred_id, alert):
        """Dedupe: an open alert of the same type for the patient blocks a new one."""
        if not alert:
            return None
        if any(a["patient_id"] == patient_id and a["alert_type"] == alert["alert_type"]
               and a["status"] == "open" for a in self.alerts):
            return None
        row = {"id": len(self.alerts) + 1, "patient_id": patient_id, "risk_prediction_id": pred_id,
               "status": "open", **alert}
        self.alerts.append(row)
        return row

    def record_risk_prediction(self, report_id, attestation):
        if self.fail_record:
            raise RuntimeError("simulated failure: nothing written")
        v = verify_attestation(self.attestation_secret or "", attestation)
        assert v["report_id"] == report_id
        rep = self.get_visit_report(report_id)
        existing = next((p for p in self.predictions if p["visit_report_id"] == report_id), None)
        if existing:
            return {"prediction": existing, "alert": None, "created": False}
        pred = {"id": len(self.predictions) + 1, "patient_id": rep["patient_id"],
                "visit_report_id": report_id, "risk_level": v["risk_level"], "trend": v["trend"],
                "confidence": v["confidence"], "probability": v["probability"],
                "prediction_horizon_hours": v["horizon_hours"], "model_version": v["model_version"],
                "input_features": self._vit(rep), "created_by": v["uid"]}
        alert = self._insert_alert(rep["patient_id"], pred["id"], v.get("alert"))
        self.predictions.append(pred)   # prediction + alert land together
        return {"prediction": pred, "alert": alert, "created": True}

    def record_auto_alert(self, patient_id, attestation):
        if self.fail_record:
            raise RuntimeError("simulated failure: nothing written")
        v = verify_attestation(self.attestation_secret or "", attestation)
        assert v["patient_id"] == patient_id
        alert = self._insert_alert(patient_id, None, v.get("alert"))
        return {"alert": alert, "created": alert is not None}
