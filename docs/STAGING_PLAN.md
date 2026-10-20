# תוכנית החלה בטוחה — `supabase/proposed/001–007` על staging

> **מטרה:** להחיל את ה-SQL המוצע על פרויקט Supabase **נפרד** (לא החי), לאמת, ורק אז לשקול קידום.
> **אסור** להחיל על הפרויקט החי `qqeupktyadjxqoxkstnl` בלי אישור מפורש של הבעלים לפי תהליך המיגרציות ב-`CLAUDE.md`.
> התוכנית נבדקת אוטומטית על Postgres מקומי חד-פעמי: `cd backend && source .venv/bin/activate && python scripts/verify_proposed_sql.py`
> (אותו סקריפט מריץ את בדיקות ה-post-flight ואת בלוקי ה-ROLLBACK שבמסמך הזה).

## 1. תנאים מקדימים
- [ ] פרויקט Supabase **חדש וחינמי** (staging). לרשום את ה-ref שלו, ולוודא שהוא **לא** `qqeupktyadjxqoxkstnl`.
- [ ] להחיל קודם את `supabase/migrations/*.sql` (16 קבצים, לפי הסדר) על ה-staging, או לשכפל סכמה. ה-SQL המוצע מניח אותם.
- [ ] משתני סביבה ל-backend (ר' `backend/README.md`): `SUPABASE_URL`, `SUPABASE_JWT_SECRET` (של ה-staging), `ALLOWED_ORIGINS`, `PREDICTIVE_SERVICE_URL`, `RISK_ATTESTATION_SECRET`.
- [ ] **`RISK_ATTESTATION_SECRET` חייב להיות שונה בין staging לפרודקשן** (≥ 32 בייטים אקראיים, hex). לא נשמר בקוד ולא ב-git.
- [ ] נתוני staging **סינתטיים בלבד**.

## 2. סדר וקשרים בין הקבצים
| קובץ | תלות | מה מוסיף |
|---|---|---|
| 001 | טבלאות `bookings`, `medical_staff` | עמודות אישור/כתובת/check-in/idempotency + אינדקס ייחודי |
| 002 | 001 | `check_in_visit` (בעלים או מנהל, `now()` מהשרת) |
| 003 | 001 | `complete_visit` (אטומי, בעלים או מנהל) |
| 004 | 001 | `staff_busy_blocks` (בלי כתובות של אחרים) |
| 005 | 001 | טריגרי `bookings`: אישור כפוי `requested`, התנגשות+מרווח 30 דק', בעלות |
| 006 | הסכמה הקיימת | `server_secrets`, HMAC, `record_risk_prediction`, `record_auto_alert`, שלילת INSERT, טריגרי `alerts`/`tasks` |
| 007 | טבלאות התיק הרפואי | כפיית זהות כותב, `alerts` מחיקה למנהל בלבד |

להחיל **לפי הסדר 001 ← 007**. כל קובץ idempotent (`if not exists` / `create or replace` / `drop trigger if exists`), והסקריפט מאמת הרצה כפולה.

## 3. Pre-flight (לפני ההחלה, על staging)
1. `get_advisors` (security + performance): לשמור את הפלט כבסיס.
2. ספירות שורות: `select 'bookings', count(*) from bookings union all select 'visit_reports', count(*) from visit_reports union all select 'risk_predictions', count(*) from risk_predictions union all select 'alerts', count(*) from alerts;`
3. גיבוי: Supabase ← Database ← Backups (או `pg_dump` של סכמת `public`).
4. לוודא שאין משתמשים אמיתיים בפרויקט.

## 4. החלה
לכל קובץ: להריץ ב-SQL editor (או `apply_migration`), לבדוק שאין שגיאה, ולרשום את גרסת המיגרציה. אחרי 006: שלב מפעיל חד-פעמי:

```sql
insert into public.server_secrets(name, value) values ('risk_attestation_secret', '<אותו ערך כמו RISK_ATTESTATION_SECRET בבקאנד>')
on conflict (name) do update set value = excluded.value;
```
עד שהסוד קיים הפונקציות נכשלות סגור (42501), וזה תקין.

## 5. Post-flight (חייבים להיות TRUE)
הרשימה המלאה נמצאת ב-`backend/scripts/verify_proposed_sql.py` (`POSTFLIGHT`) ורצה ב-`backend/tests_db/test_staging_postflight.py`. תמצית:
- אינדקס idempotency ואינדקס הזמנה כפולה קיימים.
- טריגרי 005 (2), 006 (3), 007 (8) קיימים.
- ל-`anon`: אין הרשאות טבלה ואין EXECUTE על הפונקציות שלנו.
- `record_risk_prediction`: לא ל-`anon`, כן ל-`authenticated`. עוזרי HMAC/אימות: לא ל-`authenticated`.
- אין INSERT ישיר ל-`risk_predictions` / `alerts` עבור `authenticated`.
- `server_secrets`: אין גישה ל-`anon`/`authenticated`, RLS פעיל.
- `clinical_notes`: INSERT בלבד (אין UPDATE/DELETE).
- עמודות רגישות של `medical_staff` (ת"ז, אימייל) לא נקראות ע"י `authenticated`.
- RLS פעיל על כל טבלה ב-`public`.

אחר כך: `get_advisors` שוב והשוואה לבסיס, והרצת מסע מלא (מטופל ← מנהל ← אחות ← השלמה ← חיזוי) מול ה-backend המקומי המצביע על staging.

## 6. Rollback (לפי סדר הפוך: 011 ← 001)
> **אזהרה:** `-- ROLLBACK 006` מוחק את הטבלה `server_secrets` (הסוד), ו-`-- ROLLBACK 001` מוחק עמודות (נתוני כתובת/idempotency/check-in שנאספו). שניהם **לא הפיכים** בלי גיבוי מ-pre-flight. 006 גם **מחזיר** הרשאת INSERT ישירה ל-`risk_predictions`/`alerts` (מצב לפני 006).

```sql
-- ROLLBACK 011
drop view if exists public.current_patient_risk;
create view public.current_patient_risk with (security_invoker = true) as
  select distinct on (patient_id) patient_id, risk_level, trend, confidence, probability, predicted_at, expires_at,
         prediction_horizon_hours, visit_report_id
    from public.risk_predictions where expires_at > now() order by patient_id, predicted_at desc;
revoke all on public.current_patient_risk from anon;
grant select on public.current_patient_risk to authenticated;
```

```sql
-- ROLLBACK 010
drop trigger if exists bookings_update_conflict_guard on public.bookings;
drop function if exists public.bookings_update_conflict_guard();
```

```sql
-- ROLLBACK 009
drop policy if exists medical_staff_select_own_history on public.medical_staff;
drop trigger if exists bookings_assign_active_staff_guard on public.bookings;
drop function if exists public.bookings_assign_active_staff_guard();
alter table public.bookings drop constraint bookings_staff_id_fkey,
  add constraint bookings_staff_id_fkey foreign key (staff_id) references public.medical_staff(id) on delete cascade;
alter table public.visit_reports drop constraint visit_reports_staff_id_fkey,
  add constraint visit_reports_staff_id_fkey foreign key (staff_id) references public.medical_staff(id) on delete cascade;
```

```sql
-- ROLLBACK 008
drop trigger if exists visit_reports_integrity_guard on public.visit_reports;
drop function if exists public.visit_reports_integrity_guard();
```

```sql
-- ROLLBACK 007
drop trigger if exists medication_events_authorship on public.medication_events;
drop trigger if exists service_plans_authorship on public.service_plans;
drop trigger if exists patient_allergies_authorship on public.patient_allergies;
drop trigger if exists patient_documents_authorship on public.patient_documents;
drop trigger if exists patient_medical_history_authorship on public.patient_medical_history;
drop trigger if exists service_plan_visits_authorship on public.service_plan_visits;
drop trigger if exists clinical_notes_authorship on public.clinical_notes;
drop trigger if exists alerts_guard_delete on public.alerts;
drop function if exists public.authorship_guard_created_by();
drop function if exists public.patient_documents_authorship();
drop function if exists public.patient_medical_history_authorship();
drop function if exists public.service_plan_visits_authorship();
drop function if exists public.clinical_notes_authorship();
drop function if exists public.alerts_guard_delete();
drop function if exists public._is_jwt_admin();
```

```sql
-- ROLLBACK 006
drop trigger if exists alerts_guard_update on public.alerts;
drop trigger if exists tasks_guard_insert on public.tasks;
drop trigger if exists tasks_guard_update on public.tasks;
drop function if exists public.alerts_guard_update();
drop function if exists public.tasks_guard_insert();
drop function if exists public.tasks_guard_update();
drop function if exists public.record_auto_alert(uuid, jsonb);
drop function if exists public.record_risk_prediction(bigint, jsonb);
drop function if exists public._insert_auto_alert(uuid, bigint, jsonb);
drop function if exists public._verify_server_attestation(jsonb);
drop function if exists public._hmac_sha256(bytea, bytea);
drop table if exists public.server_secrets;
grant insert on public.risk_predictions to authenticated;
grant insert on public.alerts to authenticated;
grant usage, select on sequence public.risk_predictions_id_seq to authenticated;
```

```sql
-- ROLLBACK 005
drop trigger if exists bookings_guard_insert on public.bookings;
drop trigger if exists bookings_guard_update on public.bookings;
drop function if exists public.bookings_guard_insert();
drop function if exists public.bookings_guard_update();
```

```sql
-- ROLLBACK 004
drop function if exists public.staff_busy_blocks(bigint, timestamptz, timestamptz, text);
```

```sql
-- ROLLBACK 003
drop function if exists public.complete_visit(bigint, jsonb);
```

```sql
-- ROLLBACK 002
drop function if exists public.check_in_visit(bigint);
```

```sql
-- ROLLBACK 001
drop index if exists public.bookings_patient_idempotency_key_uidx;
alter table public.bookings
  drop column if exists approval_status,
  drop column if exists visit_address,
  drop column if exists visit_lat,
  drop column if exists visit_lng,
  drop column if exists checked_in_at,
  drop column if exists idempotency_key;
alter table public.medical_staff
  drop column if exists base_lat,
  drop column if exists base_lng;
```

## 7. סדר מעבר באפליקציה (אחרי שה-staging נקי)
1. **Backend:** פריסה עם HTTPS, `ALLOWED_ORIGINS` לדומיין האתר, וסוד ההתחייבות של ה-staging.
2. **Frontend:** `window.BACKEND_URL` ב-`public/config.js` (לא `localhost`), והוספת מקור ה-backend ל-`connect-src` ב-`public/_headers`.
3. **Service Worker:** העלאת `CACHE_VERSION`.
4. בדיקות: `mobile-journey` ממוקק + מסע ידני על staging בנייד.
5. רק אחרי אישור מפורש של הבעלים: אותו תהליך על הפרויקט החי, עם סוד attestation **חדש ושונה**.

## 8. פערים ידועים
- מחיקת `alerts` על ידי מנהל עדיין אפשרית (מכוון). עריכת כותרת/מועד משימה ע"י צוות משויך עדיין אפשרית.
- אם הסוד דלף או זהה בין סביבות, אפשר לזייף כתיבות חתומות.
- מרווח נסיעה הוא קבוע (30 דק'), לא זמן נסיעה.
- הבדיקות המקומיות לא כוללות PostgREST/Supabase Auth אמיתיים; הרצה מלאה אחת על staging נדרשת.
