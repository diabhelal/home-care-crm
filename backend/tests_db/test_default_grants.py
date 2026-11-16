"""proposed/022: privileges left over by Supabase's default grants are revoked, legitimate access still works.

bootstrap.sql reproduces the hosted default privileges (anon/authenticated get ALL on every new table in `public`),
so these tests fail without 022. Isolated Postgres, synthetic data only. Roles: anon (no session), patient (the
anonymous-auth session of a guest), staff (nurse linked to medical_staff), admin (app_metadata.is_admin)."""
import pytest

from tests_db.conftest import as_postgres, as_user, new_uuid
from tests_db.test_risk_and_alerts import att, call, world
from tests_db.test_service_availability import pause, sqlstate_of

DENIED = "42501"


def as_anon(db):
    as_postgres(db)
    db.execute("select set_config('request.jwt.claims', '', true)")
    db.execute("set local role anon")


def other_nurse(db):
    u = new_uuid()
    as_postgres(db)
    db.execute("insert into auth.users(id) values (%s)", (u,))
    db.execute("insert into medical_staff(full_name, role, slot_duration_minutes, auth_user_id) values ('אחות ג','nurse',60,%s)", (u,))
    return u


# ---------------------------------------------------------------- risk_predictions
@pytest.mark.parametrize("sql", [
    "select 1 from risk_predictions",
    "insert into risk_predictions(patient_id, risk_level) values (gen_random_uuid(), 'red')",
    "update risk_predictions set risk_level = 'green'",
    "delete from risk_predictions",
    "select nextval('risk_predictions_id_seq')",
])
def test_anon_has_no_access_to_risk_predictions(db, sql):
    world(db)
    as_anon(db)
    assert sqlstate_of(db, sql) == DENIED


def test_no_signed_in_role_can_update_or_truncate_risk_predictions(db):
    d, rid = world(db)
    as_user(db, d["staff_user"]); call(db, rid, att(d["staff_user"], rid))
    for who, admin in ((d["pa"], False), (d["staff_user"], False), (d["admin"], True)):
        as_user(db, who, admin=admin)
        assert sqlstate_of(db, "update risk_predictions set risk_level = 'green'") == DENIED
        assert sqlstate_of(db, "truncate risk_predictions cascade") == DENIED


def test_risk_rows_still_readable_by_the_assigned_nurse_and_admin_only(db):
    d, rid = world(db)
    as_user(db, d["staff_user"]); call(db, rid, att(d["staff_user"], rid))
    q = "select count(*) from risk_predictions where patient_id = %s"
    as_user(db, d["staff_user"]); assert db.execute(q, (d["pa"],)).fetchone()[0] == 1
    as_user(db, d["admin"], admin=True); assert db.execute(q, (d["pa"],)).fetchone()[0] == 1
    stranger = other_nurse(db)
    as_user(db, stranger); assert db.execute(q, (d["pa"],)).fetchone()[0] == 0
    as_user(db, d["pb"]); assert db.execute(q, (d["pa"],)).fetchone()[0] == 0


# ---------------------------------------------------------------- service_availability
def test_anon_cannot_touch_the_table_but_still_sees_public_pauses(db):
    world(db); pause(db)
    as_anon(db)
    for sql in ("select 1 from service_availability",
                "insert into service_availability(purpose,is_paused) values ('checkup',true)",
                "update service_availability set is_paused = false",
                "delete from service_availability"):
        assert sqlstate_of(db, sql) == DENIED, sql
    assert db.execute("select count(*) from list_service_pauses()").fetchone()[0] == 1


def test_nobody_signed_in_can_delete_or_truncate_service_availability(db):
    d, _ = world(db); pause(db)
    for who, admin in ((d["pa"], False), (d["staff_user"], False), (d["admin"], True)):
        as_user(db, who, admin=admin)
        assert sqlstate_of(db, "delete from service_availability") == DENIED
        assert sqlstate_of(db, "truncate service_availability") == DENIED
    as_postgres(db)
    assert db.execute("select count(*) from service_availability").fetchone()[0] == 1


def test_admin_pause_and_resume_flow_still_works(db):
    """The admin screen (public/js/admin/services.js): upsert to pause, update to resume."""
    d, _ = world(db)
    as_user(db, d["admin"], admin=True)
    up = ("insert into service_availability(purpose,is_paused,paused_from,paused_until,public_message) "
          "values ('blood_test',true,'2031-03-05','2031-03-15',%s) on conflict (purpose) do update "
          "set is_paused=excluded.is_paused, paused_from=excluded.paused_from, paused_until=excluded.paused_until, "
          "public_message=excluded.public_message")
    db.execute(up, ("הודעה",)); db.execute(up, ("הודעה מעודכנת",))
    db.execute("update service_availability set is_paused = false where purpose = 'blood_test'")
    row = db.execute("select is_paused, public_message, updated_by::text from service_availability").fetchone()
    assert row == (False, "הודעה מעודכנת", d["admin"])


def test_trigger_only_functions_are_not_callable_but_still_fire(db):
    d, _ = world(db)
    as_postgres(db)
    for fn in ("service_availability_stamp()", "service_availability_audit()", "bookings_service_pause_guard()"):
        for role in ("anon", "authenticated"):
            assert db.execute("select has_function_privilege(%s, %s, 'execute')", (role, "public." + fn)).fetchone()[0] is False
    pause(db)   # the guard still blocks a patient's booking inside the pause (fires without EXECUTE for the caller)
    as_user(db, d["pa"])
    assert sqlstate_of(db, "insert into bookings(patient_id, staff_id, visit_purpose, scheduled_at, visit_address) "
                           "values (%s,%s,'blood_test','2031-03-10 09:00:00+00','רחוב 1')", (d["pa"], d["s1"])) == "SV001"
