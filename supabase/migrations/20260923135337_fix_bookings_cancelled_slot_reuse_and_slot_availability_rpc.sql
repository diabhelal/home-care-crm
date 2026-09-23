-- 1. מונע מתור שבוטל לחסום הזמנה מחדש של אותו staff+שעה בדיוק, תוך שמירה על הגנה
--    אטומית מפני שני תורים "פעילים" (לא מבוטלים) חופפים.
alter table public.bookings drop constraint bookings_staff_id_scheduled_at_key;
create unique index bookings_staff_id_scheduled_at_active_key
  on public.bookings (staff_id, scheduled_at)
  where status <> 'cancelled';

-- 2. RPC צר לחישוב זמינות תורים בצד לקוח (booking.html), לפני שיש session/הזמנה
--    בבעלות המטופל: RLS על bookings (bookings_select_own) מסתיר הזמנות של מטופלים
--    אחרים בכוונה (הגנת פרטיות) — אז שאילתת select רגילה לא הייתה מראה תורים תפוסים
--    ע"י מטופל אחר, והמטופל היה יכול לנסות להזמין תור שכבר תפוס (רק ליפול על שגיאת
--    unique constraint גנרית בזמן השמירה, במקום לראות אותו כתפוס מראש). הפונקציה
--    הזו (כמו current_staff_id/is_my_patient הקיימות) חושפת רק scheduled_at — בלי
--    patient_id, בלי שום פרט מזהה אחר.
create or replace function public.taken_slots(p_staff_id bigint, p_from timestamptz, p_to timestamptz)
returns table(scheduled_at timestamptz)
language sql
security definer
set search_path = public
stable
as $$
  select b.scheduled_at
  from public.bookings b
  where b.staff_id = p_staff_id
    and b.scheduled_at >= p_from
    and b.scheduled_at < p_to
    and b.status <> 'cancelled';
$$;

revoke all on function public.taken_slots(bigint, timestamptz, timestamptz) from public;
grant execute on function public.taken_slots(bigint, timestamptz, timestamptz) to authenticated;
