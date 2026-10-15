"""Server-side risk predictions / alerts (supabase/proposed/006). Isolated local Postgres, synthetic data."""
import hashlib
import hmac as hmaclib
import json
import time

import psycopg
import pytest

from app.risk import sign_attestation
from tests_db.conftest import as_postgres, as_user, new_uuid
from tests_db.test_db_guards import _report_id, seed

SECRET = "-".join(["throwaway", "unit", "value"])


def _secret(db):
    as_postgres(db)
    db.execute("insert into public.server_secrets(name, value) values ('risk_attestation_secret', %s) "
               "on conflict (name) do update set value = excluded.value", (SECRET,))


def att(uid, report_id=None, patient_id=None, *, secret=SECRET, level="red", alert=True, iat=None, **over):
    payload = {"v": 1, "uid": uid, "iat": int(time.time()) if iat is None else iat,
               "kind": "risk" if report_id is not None else "alert",
               "risk_level": level, "trend": "worsening", "confidence": 0.833, "probability": None,
               "horizon_hours": 8, "model_version": "rule-based-v1",
               "alert": (alert if isinstance(alert, dict) else
                         {"alert_type": "new_red", "severity": "high", "message": "אדום"}) if alert else None}
    if report_id is not None:
        payload["report_id"] = report_id
    else:
        payload["patient_id"] = patient_id
    payload.update(over)
    return json.dumps(sign_attestation(secret, payload))


def world(db):
    d = seed(db)
    rid = _report_id(db, d)     # completed by staff_user (s1) for patient pa
    _secret(db)
    return d, rid


def call(db, rid, a):
    return db.execute("select record_risk_prediction(%s, %s::jsonb)", (rid, a)).fetchone()[0]


def test_hmac_matches_python(db):
    as_postgres(db)
    got = db.execute("select encode(_hmac_sha256(convert_to(%s,'UTF8'), convert_to(%s,'UTF8')),'hex')",
                     (SECRET, "hello")).fetchone()[0]
    assert got == hmaclib.new(SECRET.encode(), b"hello", hashlib.sha256).hexdigest()
    long_key = "k" * 100
    got = db.execute("select encode(_hmac_sha256(convert_to(%s,'UTF8'), convert_to(%s,'UTF8')),'hex')",
                     (long_key, "m")).fetchone()[0]
    assert got == hmaclib.new(long_key.encode(), b"m", hashlib.sha256).hexdigest()


@pytest.mark.parametrize("table", ["risk_predictions", "alerts"])
def test_no_direct_insert_for_staff_or_admin(db, table):
    d, rid = world(db)
    for who, admin in ((d["staff_user"], False), (d["admin"], True)):
        as_user(db, who, admin=admin)
        db.execute("savepoint sp")
        with pytest.raises(psycopg.errors.InsufficientPrivilege):
            if table == "alerts":
                db.execute("insert into alerts(patient_id, alert_type, severity, message) "
                           "values (%s,'new_red','high','forged')", (d["pa"],))
            else:
                db.execute("insert into risk_predictions(patient_id, visit_report_id, input_features, "
                           "risk_level, expires_at) values (%s,%s,'{}','red', now())", (d["pa"], rid))
        db.execute("rollback to savepoint sp")


def test_staff_records_prediction_and_alert_atomically_with_server_fields(db):
    d, rid = world(db)
    as_user(db, d["staff_user"])
    out = call(db, rid, att(d["staff_user"], rid))
    assert out["created"] is True
    p, a = out["prediction"], out["alert"]
    assert p["created_by"] == d["staff_user"] and p["patient_id"] == d["pa"]
    assert p["risk_level"] == "red" and p["visit_report_id"] == rid
    assert a["risk_prediction_id"] == p["id"] and a["status"] == "open" and a["alert_type"] == "new_red"
    as_postgres(db)
    row = db.execute("select predicted_at = now(), expires_at = now() + interval '8 hours' "
                     "from risk_predictions where id=%s", (p["id"],)).fetchone()
    assert row == (True, True)    # same transaction => now() is identical: server clock, not client


def test_input_features_come_from_the_report_not_the_caller(db):
    d, rid = world(db)
    as_user(db, d["staff_user"])
    p = call(db, rid, att(d["staff_user"], rid, input_features={"pulse": 1}))["prediction"]
    assert set(p["input_features"]) == {"systolic_bp", "diastolic_bp", "blood_sugar", "pulse",
                                        "temperature", "oxygen_saturation"}
    assert p["input_features"]["pulse"] is None          # the stored report has no pulse; caller's 1 ignored


def test_cannot_forge_without_secret(db):
    d, rid = world(db)
    as_user(db, d["staff_user"])
    for forged in (att(d["staff_user"], rid, secret="guess"),
                   json.dumps({"payload": json.dumps({"risk_level": "red"}), "sig": "00"}),
                   "{}"):
        db.execute("savepoint sp")
        with pytest.raises(psycopg.errors.InsufficientPrivilege):
            call(db, rid, forged)
        db.execute("rollback to savepoint sp")
    as_postgres(db)
    assert db.execute("select count(*) from risk_predictions").fetchone()[0] == 0
    assert db.execute("select count(*) from alerts").fetchone()[0] == 0


def test_fails_closed_when_secret_not_configured(db):
    d = seed(db); rid = _report_id(db, d)
    as_user(db, d["staff_user"])
    with pytest.raises(psycopg.errors.InsufficientPrivilege):
        call(db, rid, att(d["staff_user"], rid))


def test_attestation_bound_to_user_report_and_time(db):
    d, rid = world(db)
    as_user(db, d["staff_user"])
    cases = [att(d["admin"], rid),                              # issued for another user
             att(d["staff_user"], rid + 999),                   # another report
             att(d["staff_user"], rid, iat=int(time.time()) - 3600)]   # stale
    for a in cases:
        db.execute("savepoint sp")
        with pytest.raises(psycopg.errors.InsufficientPrivilege):
            call(db, rid, a)
        db.execute("rollback to savepoint sp")


def test_other_staff_and_patient_denied(db):
    d, rid = world(db)
    other_staff = new_uuid()
    as_postgres(db)
    db.execute("insert into auth.users(id) values (%s)", (other_staff,))
    db.execute("insert into medical_staff(full_name, role, slot_duration_minutes, auth_user_id) "
               "values ('אחות ג','nurse',60,%s)", (other_staff,))
    for who in (other_staff, d["pa"], d["pb"]):
        as_user(db, who)
        db.execute("savepoint sp")
        with pytest.raises(psycopg.errors.InsufficientPrivilege):
            call(db, rid, att(who, rid))
        db.execute("rollback to savepoint sp")


def test_admin_ok_and_unknown_report(db):
    d, rid = world(db)
    as_user(db, d["admin"], admin=True)
    out = call(db, rid, att(d["admin"], rid))
    assert out["prediction"]["created_by"] == d["admin"]
    db.execute("savepoint sp")
    with pytest.raises(psycopg.errors.NoDataFound):
        call(db, rid + 999, att(d["admin"], rid + 999))
    db.execute("rollback to savepoint sp")


def test_invalid_values_rejected_and_nothing_written(db):
    d, rid = world(db)
    as_user(db, d["staff_user"])
    for over in ({"level": "purple"}, {"trend": "sideways"}, {"horizon_hours": 0}, {"confidence": 7}):
        kw = dict(over)
        if "level" in kw:
            a = att(d["staff_user"], rid, level=kw["level"])
        else:
            a = att(d["staff_user"], rid, **kw)
        db.execute("savepoint sp")
        with pytest.raises(psycopg.errors.InvalidParameterValue):
            call(db, rid, a)
        db.execute("rollback to savepoint sp")
    db.execute("savepoint sp")
    with pytest.raises(psycopg.errors.InvalidParameterValue):    # bad alert type: prediction rolled back too
        call(db, rid, att(d["staff_user"], rid, alert={"alert_type": "made_up", "severity": "high", "message": "m"}))
    db.execute("rollback to savepoint sp")
    as_postgres(db)
    assert db.execute("select count(*) from risk_predictions").fetchone()[0] == 0


def test_idempotent_per_report_and_alert_dedupe(db):
    d, rid = world(db)
    as_user(db, d["staff_user"])
    first = call(db, rid, att(d["staff_user"], rid))
    second = call(db, rid, att(d["staff_user"], rid, level="green"))
    assert first["created"] and not second["created"]
    assert second["prediction"]["id"] == first["prediction"]["id"]
    assert second["prediction"]["risk_level"] == "red"       # stored value wins
    as_postgres(db)
    assert db.execute("select count(*) from risk_predictions").fetchone()[0] == 1
    assert db.execute("select count(*) from alerts").fetchone()[0] == 1


def test_repeat_call_creates_no_second_alert(db):
    d, rid = world(db)
    as_user(db, d["staff_user"])
    call(db, rid, att(d["staff_user"], rid))
    r = call(db, rid, att(d["staff_user"], rid))           # same report: idempotent
    assert r["alert"] is None
    as_postgres(db)
    assert db.execute("select count(*) from alerts where status='open'").fetchone()[0] == 1


def test_auto_alert_function(db):
    d, rid = world(db)
    as_user(db, d["staff_user"])
    out = db.execute("select record_auto_alert(%s, %s::jsonb)",
                     (d["pa"], att(d["staff_user"], patient_id=d["pa"]))).fetchone()[0]
    assert out["created"] and out["alert"]["risk_prediction_id"] is None
    again = db.execute("select record_auto_alert(%s, %s::jsonb)",
                       (d["pa"], att(d["staff_user"], patient_id=d["pa"]))).fetchone()[0]
    assert again["created"] is False and again["alert"] is None      # open alert of that type exists
    # denied for a patient and for a staff member not assigned to the patient
    as_user(db, d["pb"])
    with pytest.raises(psycopg.errors.InsufficientPrivilege):
        db.execute("select record_auto_alert(%s, %s::jsonb)", (d["pa"], att(d["pb"], patient_id=d["pa"])))


def test_alert_ack_trigger_overrides_client_values(db):
    d, rid = world(db)
    as_user(db, d["staff_user"])
    aid = call(db, rid, att(d["staff_user"], rid))["alert"]["id"]
    db.execute("update alerts set status='acknowledged', acknowledged_by=%s, "
               "acknowledged_at='1999-01-01' where id=%s", (d["admin"], aid))
    by, at = db.execute("select acknowledged_by, acknowledged_at = now() from alerts where id=%s", (aid,)).fetchone()
    assert str(by) == d["staff_user"] and at is True
    # a later no-status update cannot rewrite the audit trail either
    db.execute("update alerts set acknowledged_by=%s, acknowledged_at='1999-01-01' where id=%s", (d["admin"], aid))
    assert str(db.execute("select acknowledged_by from alerts where id=%s", (aid,)).fetchone()[0]) == d["staff_user"]
    # resolve is allowed; content is immutable
    db.execute("update alerts set status='resolved' where id=%s", (aid,))
    db.execute("savepoint sp")
    with pytest.raises(psycopg.errors.InsufficientPrivilege):
        db.execute("update alerts set severity='low', message='x' where id=%s", (aid,))
    db.execute("rollback to savepoint sp")


def test_task_triggers_force_actor_and_time(db):
    d, rid = world(db)
    as_user(db, d["staff_user"])
    tid = db.execute("insert into tasks(patient_id, title, due_at, created_by, status, completed_by) "
                     "values (%s,'מעקב', now() + interval '1 day', %s, 'completed', %s) returning id",
                     (d["pa"], d["admin"], d["admin"])).fetchone()[0]
    row = db.execute("select created_by, status, completed_by from tasks where id=%s", (tid,)).fetchone()
    assert str(row[0]) == d["staff_user"] and row[1] == "pending" and row[2] is None
    db.execute("update tasks set status='completed', completed_by=%s, completed_at='1999-01-01' where id=%s",
               (d["admin"], tid))
    by, at = db.execute("select completed_by, completed_at = now() from tasks where id=%s", (tid,)).fetchone()
    assert str(by) == d["staff_user"] and at is True
    db.execute("savepoint sp")
    with pytest.raises(psycopg.errors.InsufficientPrivilege):
        db.execute("update tasks set patient_id=%s where id=%s", (d["pb"], tid))
    db.execute("rollback to savepoint sp")


def test_secrets_table_unreadable(db):
    d, rid = world(db)
    for who in (d["staff_user"], d["admin"]):
        as_user(db, who, admin=(who == d["admin"]))
        db.execute("savepoint sp")
        with pytest.raises(psycopg.errors.InsufficientPrivilege):
            db.execute("select * from server_secrets")
        db.execute("rollback to savepoint sp")
