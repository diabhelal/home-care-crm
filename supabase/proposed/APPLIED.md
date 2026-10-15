# מצב החלה של ההצעות

כל הקבצים הוחלו על הפרויקט החי ב-2026-10-15 (לפי תהליך המיגרציות), ואומתו ב-15 בדיקות post-flight.

| קובץ | גרסה רשומה |
|---|---|
| 001_booking_approval_and_visit_columns | 20261015154029 |
| 002_check_in_visit | 20261015154054 |
| 003_complete_visit | 20261015154103 |
| 004_staff_busy_blocks | 20261015154120 |
| 005_booking_write_guards | 20261015154829 |
| 006_server_side_risk_and_alerts | 20261015155034 (+ סוד אטסטציה הוכנס ל-`server_secrets`; לא ב-git) |
| 007_server_derived_authorship | 20261015155238 (גרסה מתוקנת: DELETE בטריגר clinical_notes לא בולע cascade) |

הקבצים הועתקו ל-`supabase/migrations/` עם הגרסה הרשומה. התיקייה הזאת נשארת כמקור וכקלט לבדיקות
(`backend/scripts/verify_proposed_sql.py`). **לפני שימוש אמיתי יש להחליף את סוד האטסטציה לערך חדש** (הערך הנוכחי הופיע בשיחת העבודה).
