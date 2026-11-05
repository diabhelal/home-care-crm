# מצב החלה של ההצעות

**001–007 הוחלו על הפרויקט החי ב-2026-10-15** (לפי תהליך המיגרציות) ואומתו ב-15 בדיקות post-flight. **008 ואילך לא הוחלו** (אומת בקריאה בלבד ב-2026-10-31: 23 מיגרציות רשומות). פירוט והשפעה: `docs/DATABASE.md`.

| קובץ | גרסה רשומה |
|---|---|
| 001_booking_approval_and_visit_columns | 20261015154029 |
| 002_check_in_visit | 20261015154054 |
| 003_complete_visit | 20261015154103 |
| 004_staff_busy_blocks | 20261015154120 |
| 005_booking_write_guards | 20261015154829 |
| 006_server_side_risk_and_alerts | 20261015155034 (+ סוד אטסטציה הוכנס ל-`server_secrets`; לא ב-git) |
| 007_server_derived_authorship | 20261015155238 (גרסה מתוקנת: DELETE בטריגר clinical_notes לא בולע cascade) |
| 008_visit_report_integrity | **לא הוחל** (נבדק רק על Postgres מבודד; ממתין לאישור החלה) |
| 017_amendments_author_only | **לא הוחל** (תיקון רק ע"י המחבר, previous_values; נבדק על Postgres מבודד 18 ו-16) |
| 016_visit_report_authorship_and_lock | **לא הוחל** (מחבר ונעילה לפי locked_at; נבדק על Postgres מבודד) |
| 015_block_physical_deletes | **לא הוחל** (חסימת מחיקה, FK RESTRICT, יומנים בלתי-ניתנים לשינוי, תיקון log_audit_change; נבדק על Postgres מבודד) |
| 013_patient_archive_and_record_export | **לא הוחלה** (ארכיון מטופל + הוצאת תיק משפטית עם יומן גישה; נבדקה על Postgres מבודד) |
| 012_visit_report_amendments | **לא הוחלה** (טבלה חדשה append-only; נבדקה על Postgres מבודד) |
| 011_risk_status_always_visible | **לא הוחלה** (view בלבד; נבדקה על Postgres מבודד) |
| 010_booking_update_conflict_guard | **לא הוחל** (נבדק על Postgres מבודד, כולל בדיקות מקביליות) |
| 009_staff_deactivate_not_delete | **לא הוחל** (כנ"ל; כולל מדיניות SELECT אחת צרה, ראו כותרת הקובץ) |
| 018_record_archive_and_void | **לא הוחלה** (ארכיון/ביטול במקום מחיקה; נבדקה על Postgres מבודד 18.4 ו-16.14; תלויה ב-013, 015, 016) |
| 019_staff_access_active_relationship | **לא הוחלה** (`is_my_patient` לפי קשר טיפולי פעיל; נבדקה על Postgres מבודד; החלטות פתוחות בכותרת הקובץ) |

הקבצים 001–007 הועתקו ל-`supabase/migrations/` עם הגרסה הרשומה. התיקייה הזאת נשארת כמקור וכקלט לבדיקות
(`backend/scripts/verify_proposed_sql.py`). **לפני שימוש אמיתי יש להחליף את סוד האטסטציה לערך חדש** (הערך הנוכחי הופיע בשיחת העבודה).
