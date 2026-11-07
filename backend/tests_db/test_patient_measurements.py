"""Append-only vital-sign measurements added outside a booking (proposed/020). Isolated Postgres, synthetic data only."""
from datetime import timezone

import psycopg

from tests_db.conftest import as_postgres, as_user, new_uuid
from tests_db.test_db_guards import insert_booking, seed
from tests_db.test_visit_report_integrity import attempt

INS = ("insert into patient_measurements(patient_id, measured_at, systolic_bp, pulse, note) "
       "values (%s, %s, %s, %s, %s) returning id")
PAST = "2026-10-01 08:30:00+00"


def assigned(db, d):
    """The staff member gets a booking with patient A (that is what 'assigned' means)."""
    as_postgres(db)
    insert_booking(db, d["pa"], d["s1"], "2026-11-20 09:00:00+00")


def test_assigned_staff_adds_a_measurement_with_two_distinct_times(db):
    d = seed(db); assigned(db, d)
    as_user(db, d["staff_user"])
    mid = db.execute(INS, (d["pa"], PAST, 130, 80, "נמדד בבית המטופל אתמול")).fetchone()[0]
    row = db.execute("select measured_at, recorded_at, recorded_by, recorded_by_role from patient_measurements where id=%s", (mid,)).fetchone()
    assert row[0].astimezone(timezone.utc).strftime("%Y-%m-%dT%H:%M") == "2026-10-01T08:30"          # the time of the measurement is the one the user gave
    assert row[1] > row[0]                                             # the entry time is the server's "now"
    assert str(row[2]) == d["staff_user"] and row[3] == "nurse"
    as_postgres(db)
    assert db.execute("select count(*) from audit_log where table_name='patient_measurements'").fetchone()[0] == 1


def test_client_cannot_set_the_entry_time_or_the_author(db):
    d = seed(db); assigned(db, d)
    as_user(db, d["staff_user"])
    mid = db.execute("insert into patient_measurements(patient_id, measured_at, recorded_at, recorded_by, recorded_by_role, pulse) "
                     "values (%s, %s, '2020-01-01', %s, 'admin', 70) returning id", (d["pa"], PAST, d["admin"])).fetchone()[0]
    row = db.execute("select recorded_at, recorded_by, recorded_by_role from patient_measurements where id=%s", (mid,)).fetchone()
    assert row[0].year >= 2026 and str(row[1]) == d["staff_user"] and row[2] == "nurse"


def test_unassigned_staff_other_patients_and_anon_cannot_write(db):
    d = seed(db); assigned(db, d)
    other = new_uuid()
    as_postgres(db)
    db.execute("insert into auth.users(id) values (%s)", (other,))
    db.execute("insert into medical_staff(full_name, role, slot_duration_minutes, auth_user_id) values ('אחות ג','nurse',60,%s)", (other,))
    as_user(db, other)
    attempt(db, INS, (d["pa"], PAST, 120, 70, None), psycopg.errors.InsufficientPrivilege)            # not assigned to this patient
    as_user(db, d["staff_user"])
    attempt(db, INS, (d["pb"], PAST, 120, 70, None), psycopg.errors.InsufficientPrivilege)            # assigned, but to another patient
    as_user(db, d["pa"])
    attempt(db, INS, (d["pa"], PAST, 120, 70, None), psycopg.errors.InsufficientPrivilege)            # a patient cannot write her own chart


def test_cancelled_booking_does_not_grant_write_access(db):
    d = seed(db)
    as_postgres(db)
    bid = insert_booking(db, d["pa"], d["s1"], "2026-11-21 09:00:00+00")[0]
    db.execute("update bookings set status='cancelled' where id=%s", (bid,))
    as_user(db, d["staff_user"])
    # With 019 applied (the full proposed chain, as in these tests) a cancelled booking is not a care relationship.
    attempt(db, INS, (d["pa"], PAST, 120, 70, None), psycopg.errors.InsufficientPrivilege)


def test_admin_can_add_and_is_recorded_as_admin(db):
    d = seed(db)
    as_user(db, d["admin"], admin=True)
    mid = db.execute(INS, (d["pb"], PAST, 118, 66, None)).fetchone()[0]
    assert db.execute("select recorded_by_role from patient_measurements where id=%s", (mid,)).fetchone()[0] == "admin"


def test_append_only_even_for_admin(db):
    d = seed(db); assigned(db, d)
    as_user(db, d["staff_user"]); mid = db.execute(INS, (d["pa"], PAST, 130, 80, None)).fetchone()[0]
    for who, admin in (("staff_user", False), ("admin", True)):
        as_user(db, d[who], admin=admin)
        attempt(db, "update patient_measurements set pulse=1 where id=%s", (mid,), psycopg.errors.InsufficientPrivilege)
        attempt(db, "delete from patient_measurements where id=%s", (mid,), psycopg.errors.InsufficientPrivilege)


def test_validation_future_time_ranges_and_empty_measurement(db):
    d = seed(db); assigned(db, d)
    as_user(db, d["staff_user"])
    attempt(db, INS, (d["pa"], "2999-01-01 00:00:00+00", 120, 70, None), psycopg.errors.InvalidParameterValue)   # future
    attempt(db, INS, (d["pa"], PAST, 999, 70, None), psycopg.errors.CheckViolation)                              # out of range
    attempt(db, "insert into patient_measurements(patient_id, measured_at, note) values (%s,%s,'רק הערה')", (d["pa"], PAST), psycopg.errors.CheckViolation)
    assert db.execute("insert into patient_measurements(patient_id, measured_at, temperature) values (%s, now() + interval '1 minute', 37.2) returning id",
                      (d["pa"],)).fetchone()[0]                                                                    # small clock skew tolerated


def test_visibility_assigned_staff_and_admin_only(db):
    d = seed(db); assigned(db, d)
    as_user(db, d["staff_user"]); db.execute(INS, (d["pa"], PAST, 130, 80, None))
    for who, admin, expected in (("staff_user", False, 1), ("admin", True, 1), ("pa", False, 0), ("pb", False, 0)):
        as_user(db, d[who], admin=admin)
        assert db.execute("select count(*) from patient_measurements").fetchone()[0] == expected, who


def test_a_patient_with_measurements_cannot_be_erased_by_a_cascade(db):
    d = seed(db); assigned(db, d)
    as_user(db, d["staff_user"]); db.execute(INS, (d["pa"], PAST, 130, 80, None))
    as_postgres(db)
    db.execute("select set_config('request.jwt.claims', '', true)")
    assert_delete_restricts(db, "patient_measurements", "patient_id", "patients")


def test_completed_visit_report_is_not_touched_by_a_new_measurement(db):
    from tests_db.test_visit_report_integrity import COMPLETE, booking
    d = seed(db)
    bid = booking(db, d)
    as_user(db, d["staff_user"])
    rid = db.execute("select id from complete_visit(%s, %s::jsonb)", (bid, COMPLETE)).fetchone()[0]
    before = db.execute("select pulse, systolic_bp, treatment_summary from visit_reports where id=%s", (rid,)).fetchone()
    db.execute(INS, (d["pa"], PAST, 150, 99, "מדידת המשך"))
    assert db.execute("select pulse, systolic_bp, treatment_summary from visit_reports where id=%s", (rid,)).fetchone() == before


def test_readings_can_be_linked_to_the_patients_own_visit_and_repeats_are_kept(db):
    d = seed(db); assigned(db, d)
    as_postgres(db)
    bid = db.execute("select id from bookings where patient_id=%s", (d["pa"],)).fetchone()[0]
    as_user(db, d["staff_user"])
    ins = ("insert into patient_measurements(patient_id, booking_id, measured_at, systolic_bp) values (%s,%s,%s,%s) returning id")
    ids = [db.execute(ins, (d["pa"], bid, t, v)).fetchone()[0]
           for t, v in (("2026-10-01 08:00:00+00", 150), ("2026-10-01 08:30:00+00", 140), ("2026-10-01 09:00:00+00", 140))]
    db.execute(INS, (d["pa"], PAST, 120, 70, None))                                    # a standalone one (no booking)
    rows = db.execute("select booking_id, systolic_bp from patient_measurements where patient_id=%s order by measured_at, id", (d["pa"],)).fetchall()
    assert len(set(ids)) == 3 and [r[1] for r in rows].count(140) == 2                  # nothing overwritten, repeats allowed
    assert sum(1 for r in rows if r[0] == bid) == 3 and sum(1 for r in rows if r[0] is None) == 1


def test_a_reading_cannot_be_linked_to_another_patients_visit(db):
    d = seed(db); assigned(db, d)
    as_postgres(db)
    other_booking = insert_booking(db, d["pb"], d["s1"], "2026-11-21 09:00:00+00")[0]   # same nurse, DIFFERENT patient
    as_user(db, d["staff_user"])
    attempt(db, "insert into patient_measurements(patient_id, booking_id, measured_at, pulse) values (%s,%s,%s,80)",
            (d["pa"], other_booking, PAST), psycopg.errors.InvalidParameterValue)
    attempt(db, "insert into patient_measurements(patient_id, booking_id, measured_at, pulse) values (%s,99999999,%s,80)",
            (d["pa"], PAST), psycopg.errors.InvalidParameterValue)
