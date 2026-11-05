"""Archive / void instead of delete (proposed/018). Isolated Postgres, synthetic data only.

Owner rules: nothing is physically deleted (015); only the ORIGINAL AUTHOR archives or voids, from an ACTIVE account, with a
reason; the actor and time come from the server; void is irreversible; append-only records are never edited - a correction is a
new row (supersedes_id) and the old one is voided."""
import psycopg
import pytest

from tests_db.conftest import as_postgres, as_user, new_uuid
from tests_db.test_block_physical_deletes import no_jwt
from tests_db.test_db_guards import seed
from tests_db.test_visit_report_integrity import COMPLETE, attempt, booking

STATE = psycopg.errors.ObjectNotInPrerequisiteState      # 55000
DENIED = psycopg.errors.InsufficientPrivilege            # 42501
CHECK = psycopg.errors.CheckViolation                    # 23514


def world(db):
    """Patient pa with a confirmed booking for nurse s1 (so she can see the chart), one allergy authored by her."""
    d = seed(db)
    booking(db, d)
    no_jwt(db)
    d["allergy"] = db.execute("insert into patient_allergies(patient_id, substance, created_by) values (%s,'פניצילין',%s) returning id",
                              (d["pa"], d["staff_user"])).fetchone()[0]
    return d


def void(db, table, row_id, reason="נרשם בטעות", **extra):
    sets = "voided_at = now(), void_reason = %s" + "".join(f", {k} = %s" for k in extra)
    return db.execute(f"update {table} set {sets} where id = %s", (reason, *extra.values(), row_id))


def row(db, table, row_id, cols):
    as_postgres(db)
    return db.execute(f"select {cols} from {table} where id = %s", (row_id,)).fetchone()


def test_author_voids_her_own_record_and_the_server_sets_actor_and_time(db):
    d = world(db)
    forged = new_uuid()
    as_postgres(db); db.execute("insert into auth.users(id) values (%s)", (forged,))
    as_user(db, d["staff_user"])
    void(db, "patient_allergies", d["allergy"], voided_by=forged)
    voided_at, voided_by, reason = row(db, "patient_allergies", d["allergy"], "voided_at, voided_by, void_reason")
    assert voided_at is not None and str(voided_by) == d["staff_user"] and reason == "נרשם בטעות"
    assert row(db, "patient_allergies", d["allergy"], "count(*)")[0] == 1          # the record itself is still there


def test_a_reason_is_mandatory(db):
    d = world(db)
    as_user(db, d["staff_user"])
    for blank in ("", "   "):
        attempt(db, "update patient_allergies set voided_at = now(), void_reason = %s where id = %s", (blank, d["allergy"]), CHECK)
    attempt(db, "update patient_allergies set archived_at = now() where id = %s", (d["allergy"],), CHECK)


def test_an_administrator_who_is_not_the_author_cannot_void(db):
    d = world(db)
    as_user(db, d["admin"], admin=True)
    attempt(db, "update patient_allergies set voided_at = now(), void_reason = 'x' where id = %s", (d["allergy"],), DENIED)
    attempt(db, "update patient_allergies set archived_at = now(), archive_reason = 'x' where id = %s", (d["allergy"],), DENIED)


def test_another_nurse_cannot_void_someone_elses_record(db):
    d = world(db)
    other = new_uuid()
    as_postgres(db)
    db.execute("insert into auth.users(id) values (%s)", (other,))
    db.execute("insert into medical_staff(full_name, role, slot_duration_minutes, auth_user_id) values ('אחות ג','nurse',60,%s)", (other,))
    as_user(db, other)
    cur = void(db, "patient_allergies", d["allergy"])
    assert cur.rowcount == 0                                                         # RLS: no UPDATE policy for non-authors
    assert row(db, "patient_allergies", d["allergy"], "voided_at")[0] is None


def test_a_deactivated_author_cannot_void(db):
    """Already invisible to a deactivated login (009/015 RLS), and the guard's own active-account check says no as well."""
    d = world(db)
    as_postgres(db); db.execute("update medical_staff set is_active = false where id = %s", (d["s1"],))
    as_user(db, d["staff_user"])
    assert db.execute("select public._is_active_account(%s)", (d["staff_user"],)).fetchone()[0] is False
    cur = void(db, "patient_allergies", d["allergy"])
    assert cur.rowcount == 0
    assert row(db, "patient_allergies", d["allergy"], "voided_at")[0] is None


def test_void_is_irreversible_and_its_reason_cannot_be_edited(db):
    d = world(db)
    as_user(db, d["staff_user"])
    void(db, "patient_allergies", d["allergy"])
    attempt(db, "update patient_allergies set voided_at = null, voided_by = null, void_reason = null where id = %s", (d["allergy"],), STATE)
    attempt(db, "update patient_allergies set void_reason = 'אחר' where id = %s", (d["allergy"],), STATE)


def test_archive_can_be_undone_by_the_author_and_both_changes_are_audited(db):
    d = world(db)
    as_user(db, d["staff_user"])
    db.execute("update patient_allergies set archived_at = now(), archive_reason = 'לא רלוונטי כעת' where id = %s", (d["allergy"],))
    assert row(db, "patient_allergies", d["allergy"], "archived_at is not null and archived_by is not null")[0]
    as_user(db, d["staff_user"])
    db.execute("update patient_allergies set archived_at = null where id = %s", (d["allergy"],))
    assert row(db, "patient_allergies", d["allergy"], "archived_at is null and archived_by is null and archive_reason is null")[0]
    actions = [r[0] for r in db.execute("select action from audit_log where table_name = 'patient_allergies' and row_id = %s order by id",
                                        (str(d["allergy"]),)).fetchall()]
    assert "archive" in actions and actions.count("update") >= 1


@pytest.mark.parametrize("table,cols,vals,author", [
    ("patient_allergies", "patient_id, substance, created_by", "%s,'פניצילין',%s", "created_by"),
    ("medication_events", "patient_id, medication_name, created_by", "%s,'אקמול',%s", "created_by"),
    ("patient_documents", "patient_id, document_type, storage_path, uploaded_by", "%s,'lab','p/x.pdf',%s", "uploaded_by"),
    ("clinical_notes", "patient_id, note_type, content, author_id", "%s,'general','הערה',%s", "author_id"),
])
def test_append_only_tables_never_change_content_but_can_be_voided_and_corrected_by_a_new_row(db, table, cols, vals, author):
    d = world(db)
    no_jwt(db)
    actor, is_admin = (d["admin"], True) if table == "patient_documents" else (d["staff_user"], False)   # documents are admin-uploaded
    rid = db.execute(f"insert into {table}({cols}) values ({vals}) returning id", (d["pa"], actor)).fetchone()[0]
    as_user(db, actor, admin=is_admin)
    content_col = {"patient_allergies": "substance", "medication_events": "medication_name",
                   "patient_documents": "document_type", "clinical_notes": "content"}[table]
    # frozen by the guard (clinical_notes: refused even earlier - the column-level grant covers only the markers)
    attempt(db, f"update {table} set {content_col} = 'שונה' where id = %s", (rid,), DENIED if table == "clinical_notes" else STATE)
    void(db, table, rid)                                                                            # ...but the author may void it
    assert row(db, table, rid, "voided_at is not null")[0]
    no_jwt(db)                                                                                      # correction = a NEW row pointing at the old one
    new_id = db.execute(f"insert into {table}({cols}, supersedes_id) values ({vals}, %s) returning id", (d["pa"], actor, rid)).fetchone()[0]
    assert row(db, table, new_id, "supersedes_id")[0] == rid


def test_the_old_record_cannot_be_removed_while_a_correction_points_at_it(db):
    d = world(db)
    no_jwt(db)
    new_id = db.execute("insert into patient_allergies(patient_id, substance, created_by, supersedes_id) values (%s,'פניצילין',%s,%s) returning id",
                        (d["pa"], d["staff_user"], d["allergy"])).fetchone()[0]
    assert new_id and row(db, "patient_allergies", d["allergy"], "count(*)")[0] == 1
    attempt(db, "delete from patient_allergies where id = %s", (d["allergy"],), (psycopg.errors.ForeignKeyViolation, psycopg.errors.RestrictViolation))


def test_a_visit_report_stays_locked_but_its_author_may_void_it(db):
    d = seed(db)
    bid = booking(db, d)
    as_user(db, d["staff_user"])
    rid = db.execute("select id from complete_visit(%s, %s::jsonb)", (bid, COMPLETE)).fetchone()[0]
    attempt(db, "update visit_reports set treatment_summary = 'שונה' where id = %s", (rid,), STATE)   # 016 lock unchanged
    void(db, "visit_reports", rid, reason="דוח שנפתח בטעות")
    assert row(db, "visit_reports", rid, "voided_at is not null and voided_by is not null")[0]
    as_user(db, d["admin"], admin=True)
    attempt(db, "update visit_reports set archived_at = now(), archive_reason = 'x' where id = %s", (rid,), DENIED)


def test_patient_messages_are_archived_by_an_administrator_only(db):
    d = seed(db)
    no_jwt(db)
    cid = db.execute("insert into patient_contacts(patient_id, body) values (%s,'פנייה') returning id", (d["pa"],)).fetchone()[0]
    as_user(db, d["admin"], admin=True)
    attempt(db, "update patient_contacts set archived_at = now() where id = %s", (cid,), CHECK)       # reason required
    db.execute("update patient_contacts set archived_at = now(), archive_reason = 'טופל' where id = %s", (cid,))
    assert row(db, "patient_contacts", cid, "archived_by")[0] is not None and row(db, "patient_contacts", cid, "count(*)")[0] == 1


def test_a_clinical_note_can_still_not_be_deleted_or_edited_by_a_nurse(db):
    d = world(db)
    no_jwt(db)
    nid = db.execute("insert into clinical_notes(patient_id, note_type, content, author_id) values (%s,'general','הערה',%s) returning id",
                     (d["pa"], d["staff_user"])).fetchone()[0]
    as_user(db, d["staff_user"])
    attempt(db, "update clinical_notes set content = 'x' where id = %s", (nid,), DENIED)         # column grant: markers only
    attempt(db, "delete from clinical_notes where id = %s", (nid,), DENIED)


def test_no_new_or_moved_booking_for_an_archived_patient_but_cancelling_still_works(db):
    d = seed(db)
    bid = booking(db, d)                                                                             # an existing booking for pa
    as_postgres(db); db.execute("update patients set archived_at = now(), archived_by = %s, archive_reason = 'בדיקה' where id = %s", (d["admin"], d["pa"]))
    as_user(db, d["pa"])
    attempt(db, "insert into bookings(patient_id, staff_id, visit_purpose, scheduled_at, visit_address) values (%s,%s,'checkup','2031-01-05 09:00+00','x')",
            (d["pa"], d["s1"]), STATE)
    as_user(db, d["admin"], admin=True)
    attempt(db, "update bookings set scheduled_at = '2031-01-06 09:00+00' where id = %s", (bid,), STATE)
    db.execute("update bookings set status = 'cancelled' where id = %s", (bid,))                      # cancelling is not blocked
    as_user(db, d["pb"])
    db.execute("insert into bookings(patient_id, staff_id, visit_purpose, scheduled_at, visit_address) values (%s,%s,'checkup','2031-01-05 09:00+00','y')",
               (d["pb"], d["s1"]))                                                                  # another patient is unaffected


def test_clinical_tables_without_an_audit_trigger_now_have_one(db):
    d = world(db)
    no_jwt(db)
    db.execute("insert into clinical_notes(patient_id, note_type, content, author_id) values (%s,'general','הערה',%s)", (d["pa"], d["staff_user"]))
    db.execute("insert into patient_contacts(patient_id, body) values (%s,'פנייה')", (d["pa"],))
    seen = {r[0] for r in db.execute("select distinct table_name from audit_log").fetchall()}
    assert {"clinical_notes", "patient_contacts"} <= seen
