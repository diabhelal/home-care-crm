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

## 6. Rollback (לפי סדר הפוך: 013 ← 001)
> **אזהרה:** `-- ROLLBACK 006` מוחק את הטבלה `server_secrets` (הסוד), ו-`-- ROLLBACK 001` מוחק עמודות (נתוני כתובת/idempotency/check-in שנאספו). שניהם **לא הפיכים** בלי גיבוי מ-pre-flight. 006 גם **מחזיר** הרשאת INSERT ישירה ל-`risk_predictions`/`alerts` (מצב לפני 006).

```sql
-- ROLLBACK 017
-- אזהרה: מוחק את העמודה previous_values (הערכים הקודמים שנלכדו) ומחזיר את כלל 012 (מנהל או הצוות המשויך רשאים לתקן).
drop policy if exists author_insert_visit_report_amendments on public.visit_report_amendments;
create policy admin_insert_visit_report_amendments on public.visit_report_amendments for insert to authenticated
  with check (public._is_jwt_admin());
create policy staff_insert_own_visit_report_amendments on public.visit_report_amendments for insert to authenticated
  with check (exists (select 1 from public.visit_reports vr where vr.id = visit_report_id and vr.staff_id = public.current_staff_id()));
create or replace function public.visit_report_amendments_guard()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  r      public.visit_reports;
  v_role text;
  k      text;
  val    jsonb;
  n      numeric;
begin
  if tg_op = 'DELETE' then
    if auth.uid() is not null then
      raise exception 'amendments are append-only' using errcode = '42501';
    end if;
    return old;
  end if;
  if tg_op = 'UPDATE' then
    if auth.uid() is not null then
      raise exception 'amendments are append-only' using errcode = '42501';
    end if;
    return new;
  end if;

  select * into r from public.visit_reports where id = new.visit_report_id;
  if not found then
    raise exception 'visit report not found' using errcode = '23503';
  end if;
  if auth.uid() is null then
    return new;
  end if;
  if not public._is_jwt_admin() and r.staff_id is distinct from public.current_staff_id() then
    raise exception 'not your visit report' using errcode = '42501';
  end if;

  new.patient_id  := r.patient_id;
  new.amended_by  := auth.uid();
  new.created_at  := now();
  if public._is_jwt_admin() then
    new.amended_by_role := 'admin';
  else
    select role into v_role from public.medical_staff where auth_user_id = auth.uid() limit 1;
    new.amended_by_role := v_role;
  end if;

  if jsonb_typeof(new.corrections) is distinct from 'object' then
    raise exception 'corrections must be a JSON object' using errcode = '22023';
  end if;
  for k, val in select * from jsonb_each(new.corrections) loop
    if k = 'treatment_summary' then
      if jsonb_typeof(val) <> 'string' or length(btrim(val #>> '{}')) = 0 then
        raise exception 'invalid corrected treatment_summary' using errcode = '22023';
      end if;
    elsif k in ('systolic_bp','diastolic_bp','blood_sugar','pulse','temperature','oxygen_saturation') then
      if jsonb_typeof(val) <> 'number' then
        raise exception 'corrected % must be a number', k using errcode = '22023';
      end if;
      n := (val #>> '{}')::numeric;
      if (k = 'systolic_bp'       and n not between 50 and 250)
      or (k = 'diastolic_bp'      and n not between 30 and 150)
      or (k = 'blood_sugar'       and n not between 20 and 600)
      or (k = 'pulse'             and n not between 30 and 220)
      or (k = 'temperature'       and n not between 30 and 45)
      or (k = 'oxygen_saturation' and n not between 50 and 100) then
        raise exception 'corrected % is out of the allowed range', k using errcode = '23514';
      end if;
    else
      raise exception 'field % cannot be corrected through an amendment', k using errcode = '22023';
    end if;
  end loop;
  return new;
end;
$$;
alter table public.visit_report_amendments drop column if exists previous_values;
```

```sql
-- ROLLBACK 016
-- אזהרה: מוחק את עמודות המחבר והנעילה (מידע על מי תיעד). הנעילה הישנה (לפי bookings.status) חוזרת רק אחרי הרצה חוזרת של 003 ו-008.
drop trigger if exists bookings_completed_status_guard on public.bookings;
drop function if exists public.bookings_completed_status_guard();
drop trigger if exists visit_reports_authorship_lock on public.visit_reports;
drop function if exists public.visit_reports_authorship_lock();
drop function if exists public._author_role_of(uuid);
alter table public.visit_reports drop column if exists author_user_id, drop column if exists author_role, drop column if exists locked_at;
```

```sql
-- ROLLBACK 015
-- אזהרה: מחזיר הרשאות DELETE ומפתחות זרים בעלי CASCADE/SET NULL (מצב מסוכן), ומחזיר את log_audit_change הישן (בלי old_data).
-- אם נוצרו שורות audit_log עם action חדש (delete/archive/void/amend) ה-CHECK הישן יוחזר כ-NOT VALID.
do $$
declare t text;
begin
  foreach t in array array['visit_reports','visit_report_amendments','patient_allergies','patient_medical_history','clinical_notes',
    'medication_events','patient_documents','service_plans','service_plan_visits','risk_predictions','alerts','tasks',
    'patient_contacts','audit_log','record_access_log','bookings','patients','medical_staff'] loop
    execute format('drop trigger if exists block_physical_delete on public.%I', t);
    execute format('drop trigger if exists block_physical_truncate on public.%I', t);
  end loop;
end $$;
drop function if exists public.block_physical_delete();
drop trigger if exists immutable_log_guard on public.audit_log;
drop trigger if exists immutable_log_guard_truncate on public.audit_log;
drop trigger if exists immutable_log_guard on public.record_access_log;
drop trigger if exists immutable_log_guard_truncate on public.record_access_log;
drop function if exists public.immutable_log_guard();
drop trigger if exists medical_staff_identity_guard on public.medical_staff;
drop function if exists public.medical_staff_identity_guard();
grant delete on public.visit_reports, public.patient_allergies, public.patient_medical_history, public.medication_events,
  public.patient_documents, public.service_plans, public.service_plan_visits, public.tasks, public.alerts,
  public.patient_contacts, public.medical_staff to authenticated;
do $$
declare r record;
begin
  for r in select * from (values
      ('bookings','patient_id','patients','cascade'), ('visit_reports','patient_id','patients','cascade'),
      ('visit_reports','booking_id','bookings','cascade'), ('risk_predictions','patient_id','patients','cascade'),
      ('risk_predictions','visit_report_id','visit_reports','cascade'), ('patient_allergies','patient_id','patients','cascade'),
      ('patient_medical_history','patient_id','patients','cascade'), ('clinical_notes','patient_id','patients','cascade'),
      ('medication_events','patient_id','patients','cascade'), ('medication_events','visit_report_id','visit_reports','set null'),
      ('service_plans','patient_id','patients','cascade'), ('service_plan_visits','service_plan_id','service_plans','cascade'),
      ('service_plan_visits','booking_id','bookings','set null'), ('patient_documents','patient_id','patients','cascade'),
      ('patient_contacts','patient_id','patients','cascade'), ('alerts','patient_id','patients','cascade'),
      ('alerts','risk_prediction_id','risk_predictions','set null'), ('tasks','patient_id','patients','cascade'),
      ('tasks','alert_id','alerts','set null')) as t(child, col, parent, act)
  loop
    execute format('alter table public.%I drop constraint %I, add constraint %I foreign key (%I) references public.%I(id) on delete %s',
                   r.child, r.child || '_' || r.col || '_fkey', r.child || '_' || r.col || '_fkey', r.col, r.parent, r.act);
  end loop;
end $$;
alter table public.audit_log drop constraint if exists audit_log_action_check;
alter table public.audit_log add constraint audit_log_action_check check (action in ('insert','update')) not valid;
create or replace function public.log_audit_change() returns trigger
language plpgsql security definer set search_path = public as $f$
begin
  insert into public.audit_log (actor_id, action, table_name, row_id, old_data, new_data)
  values (auth.uid(), lower(tg_op), tg_table_name,
          coalesce((to_jsonb(new)->>'id'), (to_jsonb(old)->>'id')),
          case when tg_op = 'update' then to_jsonb(old) else null end, to_jsonb(new));
  return new;
end;
$f$;
revoke execute on function public.log_audit_change() from public;
drop policy if exists "admin_select_patient_documents_storage" on storage.objects;
drop policy if exists "admin_insert_patient_documents_storage" on storage.objects;
create policy "admin_full_access_patient_documents_storage" on storage.objects
  for all to authenticated
  using (bucket_id = 'patient-documents' and coalesce(((select auth.jwt()) -> 'app_metadata' ->> 'is_admin')::boolean, false))
  with check (bucket_id = 'patient-documents' and coalesce(((select auth.jwt()) -> 'app_metadata' ->> 'is_admin')::boolean, false));
```

```sql
-- ROLLBACK 013
-- אזהרה: מוחק את יומן הגישה לתיקים (תיעוד משפטי) ואת סימוני הארכיון. לא הפיך בלי גיבוי.
drop function if exists public.export_patient_record(uuid, text, text, text);
drop table if exists public.record_access_log;
drop function if exists public.record_access_log_guard();
drop trigger if exists patients_archive_guard on public.patients;
drop function if exists public.patients_archive_guard();
alter table public.patients drop column if exists archived_at, drop column if exists archived_by, drop column if exists archive_reason;
```

```sql
-- ROLLBACK 012
-- אזהרה: מוחק את טבלת התיקונים שנאספו (התיקונים עצמם אינם ניתנים לשחזור בלי גיבוי).
drop table if exists public.visit_report_amendments;
drop function if exists public.visit_report_amendments_guard();
```

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
