-- שדה סטטוס עישון על המטופל (Phase 1 מהאפיון: הרחבת פרופיל הבסיס לצורך שכבת ה-AI/Layer B/C).
-- Nullable, ללא ברירת מחדל — "מידע חסר נשאר חסר", לא מנחשים.

alter table public.patients add column smoking_status text
  check (smoking_status in ('never','former','current','unknown'));
