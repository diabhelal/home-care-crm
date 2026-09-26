-- פניות מהאתר (patient_contacts): הוספת status לתמיכה ב"סימון כטופל/ארכיון",
-- ותיקון grant חסר — RLS (admin_full_access_patient_contacts, cmd=ALL) כבר
-- מאפשר למנהל UPDATE/DELETE, אבל ה-grant בפועל ל-authenticated כלל רק
-- INSERT/SELECT (נשכח ב-migration המקורית שיצרה את הטבלה) — בלי ה-grant, RLS
-- לא רלוונטי בכלל כי הפעולה נחסמת קודם ברמת ההרשאה.
alter table public.patient_contacts
  add column status text not null default 'open' check (status in ('open', 'archived'));

grant update, delete on public.patient_contacts to authenticated;
