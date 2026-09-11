-- מיישר בין מצב ה-DB החי לבין migrations: מוסיף 3 מדיניות admin שנוצרו בזמנו
-- ישירות דרך execute_sql (patients/medical_staff/bookings — visit_reports כבר במיגרציה קודמת),
-- ומתקן פער אבטחה אמיתי: ל-anon היו הרשאות GRANT מלאות (כולל DELETE/TRUNCATE) על
-- כל 4 הטבלאות (ברירת המחדל של Supabase לטבלה חדשה) בניגוד למתועד ("anon: ללא גישה כלל").
-- RLS כבר חסם בפועל (כל המדיניות מוגבלת ל-to authenticated), so אין ניצול פעיל שהיה קיים —
-- אבל זו רמת הגנה חשובה (defense-in-depth) שצריך לתקן.

-- ===== מדיניות admin חסרות (כבר קיימות בפועל ב-DB, כעת מתועדות + עם תיקון ביצועים
-- זהה למה שכבר בוצע ל-visit_reports: (select auth.jwt()) במקום auth.jwt() ישיר) =====

create policy "admin_full_access_patients" on public.patients
  for all to authenticated
  using (coalesce((((select auth.jwt()) -> 'app_metadata'::text) ->> 'is_admin')::boolean, false))
  with check (coalesce((((select auth.jwt()) -> 'app_metadata'::text) ->> 'is_admin')::boolean, false));

create policy "admin_full_access_medical_staff" on public.medical_staff
  for all to authenticated
  using (coalesce((((select auth.jwt()) -> 'app_metadata'::text) ->> 'is_admin')::boolean, false))
  with check (coalesce((((select auth.jwt()) -> 'app_metadata'::text) ->> 'is_admin')::boolean, false));

create policy "admin_full_access_bookings" on public.bookings
  for all to authenticated
  using (coalesce((((select auth.jwt()) -> 'app_metadata'::text) ->> 'is_admin')::boolean, false))
  with check (coalesce((((select auth.jwt()) -> 'app_metadata'::text) ->> 'is_admin')::boolean, false));

-- ===== תיקון הרשאות GRANT: anon ללא גישה כלל; authenticated מצומצם למה שהאפליקציה
-- באמת משתמשת בו בכל טבלה (לא כל הפעולות, לא TRUNCATE/REFERENCES/TRIGGER) =====

revoke all on public.patients from anon;
revoke all on public.medical_staff from anon;
revoke all on public.bookings from anon;
revoke all on public.visit_reports from anon;

revoke all on public.patients from authenticated;
grant select, insert, update on public.patients to authenticated;

revoke all on public.medical_staff from authenticated;
grant select, insert, update, delete on public.medical_staff to authenticated;

revoke all on public.bookings from authenticated;
grant select, insert, update on public.bookings to authenticated;

revoke all on public.visit_reports from authenticated;
grant select, insert, update, delete on public.visit_reports to authenticated;

grant usage, select on sequence public.medical_staff_id_seq to authenticated;
grant usage, select on sequence public.bookings_id_seq to authenticated;
grant usage, select on sequence public.visit_reports_id_seq to authenticated;
