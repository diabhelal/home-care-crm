-- Supabase's ברירת מחדל ל-schema public מעניקה EXECUTE אוטומטית ל-anon על כל
-- פונקציה חדשה (אותה תופעה בדיוק שכבר קיימת ב-current_staff_id/is_my_patient,
-- ר' get_advisors) — לא קשור ל-revoke all from public שכבר עשינו. taken_slots
-- נועדה מפורשות ל-authenticated בלבד (כל משתמש באפליקציה, כולל אורח אנונימי,
-- מקבל session authenticated אמיתי דרך signInAnonymously — ר' AGENTS.md), אז
-- מסירים את הגישה של anon (בקשה ישירה ל-REST API בלי שום session בכלל).
revoke execute on function public.taken_slots(bigint, timestamptz, timestamptz) from anon;
