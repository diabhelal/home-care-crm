# מצב החלה של ההצעות

| קובץ | מצב | גרסה רשומה |
|---|---|---|
| 001_booking_approval_and_visit_columns | **הוחל** על הפרויקט החי (2026-10-15) | 20261015154029 |
| 002_check_in_visit | **הוחל** | 20261015154054 |
| 003_complete_visit | **הוחל** | 20261015154103 |
| 004_staff_busy_blocks | **הוחל** | 20261015154120 |
| 005_booking_write_guards | **לא הוחל** (ממתין לאישור הרשאה) | — |
| 006_server_side_risk_and_alerts | **לא הוחל** (דורש גם סוד אטסטציה) | — |
| 007_server_derived_authorship | **לא הוחל** | — |

הקבצים שהוחלו הועתקו גם ל-`supabase/migrations/` עם הגרסה הרשומה (תהליך המיגרציות ב-`CLAUDE.md`).
הקבצים כאן נשארים כמקור וכקלט לבדיקות (`backend/scripts/verify_proposed_sql.py`), והם idempotent.
