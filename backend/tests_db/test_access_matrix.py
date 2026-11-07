"""Role x table READ-access matrix (RLS + grants), isolated Postgres, synthetic data only.

One table of expectations instead of scattered checks: who can see patient A's chart rows. Run against two schemas:
  * "full": supabase/migrations + supabase/proposed (what the other tests_db files use)
  * "live": supabase/migrations only = what supabase/proposed/APPLIED.md records as applied to the live project.
A cell that changes is an authorization change and must be a deliberate, owner-approved decision.
"""
import pathlib
import tempfile

import psycopg
import pytest

from tests_db.conftest import BOOTSTRAP, ROOT, _sql_files, as_postgres, as_user, new_uuid
from tests_db.test_block_physical_deletes import no_jwt

ROLES = ["anon", "patient_owner", "other_patient", "staff_assigned", "staff_unassigned", "staff_inactive", "admin"]
TABLES = ["patients", "bookings", "visit_reports", "patient_measurements"]

# rows of patient A visible to each role (1 = visible, 0 = hidden or no grant)
EXPECTED = {
    #                        anon owner other assigned unassigned inactive admin
    "patients":             (0,   1,    0,    1,       0,         0,       1),
    "bookings":             (0,   1,    0,    1,       0,         0,       1),
    "visit_reports":        (0,   1,    0,    1,       0,         0,       1),
    "patient_measurements": (0,   0,    0,    1,       0,         0,       1),   # 020 decision (c): patients do not read them
}


def _start(files):
    import pixeltable_pgserver as pgserver
    srv = pgserver.get_server(pathlib.Path(tempfile.mkdtemp()) / "pg", cleanup_mode="stop")
    with psycopg.connect(srv.get_uri(), autocommit=True) as c:
        c.execute(BOOTSTRAP.read_text(encoding="utf-8"))
        for f in files:
            c.execute(f.read_text(encoding="utf-8"))
    return srv


@pytest.fixture(scope="module", params=["full", "live"])
def schema_uri(request, pg_uri):
    if request.param == "full":
        yield pg_uri
        return
    srv = _start(sorted((ROOT / "supabase" / "migrations").glob("*.sql")))
    yield srv.get_uri()
    srv.cleanup()


@pytest.fixture()
def mdb(schema_uri):
    with psycopg.connect(schema_uri, autocommit=False) as c:
        yield c
        c.rollback()


def _seed(db):
    as_postgres(db)
    no_jwt(db)
    pa, pb, admin, s_user, s2_user, s3_user = (new_uuid() for _ in range(6))
    for u in (pa, pb, admin, s_user, s2_user, s3_user):
        db.execute("insert into auth.users(id) values (%s)", (u,))
    db.execute("insert into patients(id, full_name, phone, address) values (%s,'מטופל א','050','רחוב 1'),(%s,'מטופל ב','051','רחוב 2')", (pa, pb))
    ins = "insert into medical_staff(full_name, role, slot_duration_minutes, auth_user_id, is_active) values (%s,'nurse',60,%s,%s) returning id"
    s1 = db.execute(ins, ("אחות משויכת", s_user, True)).fetchone()[0]
    db.execute(ins, ("אחות לא משויכת", s2_user, True))
    s3 = db.execute(ins, ("אחות מושבתת", s3_user, True)).fetchone()[0]
    b1 = db.execute("insert into bookings(patient_id, staff_id, visit_purpose, scheduled_at, visit_address, approval_status) "
                    "values (%s,%s,'checkup','2031-01-01 09:00+00','רחוב 1','confirmed') returning id", (pa, s1)).fetchone()[0]
    b3 = db.execute("insert into bookings(patient_id, staff_id, visit_purpose, scheduled_at, visit_address, approval_status) "
                    "values (%s,%s,'checkup','2031-01-02 09:00+00','רחוב 1','confirmed') returning id", (pa, s3)).fetchone()[0]
    db.execute("insert into visit_reports(booking_id, patient_id, staff_id, treatment_summary) values (%s,%s,%s,'סינתטי')", (b1, pa, s1))
    has_measurements = db.execute("select to_regclass('public.patient_measurements') is not null").fetchone()[0]
    if has_measurements:
        db.execute("insert into patient_measurements(patient_id, measured_at, recorded_by, pulse) values (%s, now(), %s, 70)", (pa, admin))
    # the staff member who was assigned b3 has since been deactivated
    db.execute("update medical_staff set is_active = false where id = %s", (s3,))
    users = {"patient_owner": pa, "other_patient": pb, "staff_assigned": s_user, "staff_unassigned": s2_user,
             "staff_inactive": s3_user, "admin": admin}
    return pa, users, has_measurements


def _visible(db, role, users, table, pa):
    db.execute("savepoint m")
    try:
        if role == "anon":
            as_postgres(db); no_jwt(db); db.execute("set local role anon")
        else:
            as_user(db, users[role], admin=(role == "admin"))
        col = "id" if table == "patients" else "patient_id"
        n = db.execute(f"select count(*) from {table} where {col} = %s", (pa,)).fetchone()[0]
    except psycopg.errors.InsufficientPrivilege:
        n = 0   # no grant at all = not visible
    db.execute("rollback to savepoint m")
    return 1 if n else 0


def test_read_access_matrix(mdb):
    pa, users, has_measurements = _seed(mdb)
    actual, mismatches = {}, []
    for table in TABLES:
        if table == "patient_measurements" and not has_measurements:
            continue
        actual[table] = tuple(_visible(mdb, r, users, table, pa) for r in ROLES)
        if actual[table] != EXPECTED[table]:
            mismatches.append(f"{table}: expected {EXPECTED[table]} got {actual[table]} (roles {ROLES})")
    assert not mismatches, "\n".join(mismatches)
