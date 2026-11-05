from __future__ import annotations

SLOT_TAKEN_MSG = "המטפל אינו פנוי בשעה זו, אנא בחר משבצת זמן אחרת"


class DomainError(Exception):
    def __init__(self, status: int, code: str, message: str):
        super().__init__(message)
        self.status, self.code, self.message = status, code, message


def unauthorized(msg="נדרשת התחברות"):
    return DomainError(401, "unauthorized", msg)


def forbidden(msg="אין הרשאה לפעולה זו"):
    return DomainError(403, "forbidden", msg)


def not_found(msg="לא נמצא"):
    return DomainError(404, "not_found", msg)


def conflict(code: str, msg: str):
    return DomainError(409, code, msg)


def slot_taken():
    return DomainError(409, "slot_taken", SLOT_TAKEN_MSG)


def bad_request(code: str, msg: str):
    return DomainError(400, code, msg)


class SlotTakenError(Exception):
    """Raised by repositories on a unique violation (Postgres 23505)."""


class IdempotencyConflictError(Exception):
    """Unique violation of the per-patient idempotency index: NOT a slot conflict.
    The caller re-reads the booking by (patient_id, idempotency_key)."""


def idempotency_conflict():
    return DomainError(500, "idempotency_conflict",
                       "לא ניתן היה לאמת את ההזמנה הקודמת. אנא רענן ובדוק ב'ההזמנות שלי' לפני ניסיון נוסף")


def unexpected_unique_violation():
    return DomainError(500, "unexpected_unique_violation",
                       "שגיאת שרת בשמירת הנתונים. אנא נסה שוב או פנה לתמיכה")


def redact_details(details) -> str:
    """PostgREST `details` can quote row values ("Key (col)=(value) ..."). Keep the
    column list, drop the values, so logs never carry patient data."""
    import re
    return re.sub(r"=\(.*?\)", "=(redacted)", str(details)) if details else ""
