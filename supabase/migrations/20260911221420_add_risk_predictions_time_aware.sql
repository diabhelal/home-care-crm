-- מנוע סיכון מודע-זמן (Tier 1: rule/trend-based decision support, לא ML מאומן).
-- risk_predictions נוצרה בפועל ב-DB בסבב תכנון קודם ולא הייתה מתועדת באף migration —
-- הקובץ הזה מתעד אותה מהיסוד, בתוספת שינויי Tier 2 (horizon 8h, trend, probability)
-- ותיקון הרשאות ברירת המחדל של Supabase לטבלה חדשה.

alter table public.patients add column background_conditions text[] not null default '{}';

create table public.risk_predictions (
  id bigint generated always as identity primary key,
  patient_id uuid not null references public.patients(id) on delete cascade,
  visit_report_id bigint not null references public.visit_reports(id) on delete cascade,
  predicted_at timestamptz not null default now(),
  input_features jsonb not null,
  risk_level text not null check (risk_level in ('green','yellow','red')),
  confidence numeric(4,3),
  prediction_horizon_hours int not null default 8 check (prediction_horizon_hours > 0),
  expires_at timestamptz not null,
  model_version text not null default 'rule-based-v1',
  created_by uuid references auth.users(id),
  trend text check (trend in ('improving','stable','worsening')),
  probability numeric(5,4)
);

comment on column public.risk_predictions.confidence is 'ציון שלמות קלט (חלק מהמדדים שסופקו), לא הסתברות רפואית.';
comment on column public.risk_predictions.probability is 'שמור למודל ML מאומן אמיתי בעתיד. Tier 1 הנוכחי (rule-based) תמיד משאיר את זה null.';

create index risk_predictions_patient_id_idx on public.risk_predictions (patient_id);
create index risk_predictions_expires_at_idx on public.risk_predictions (expires_at);

alter table public.risk_predictions enable row level security;

create policy "admin_full_access_risk_predictions" on public.risk_predictions
  for all to authenticated
  using (coalesce((((select auth.jwt()) -> 'app_metadata'::text) ->> 'is_admin')::boolean, false))
  with check (coalesce((((select auth.jwt()) -> 'app_metadata'::text) ->> 'is_admin')::boolean, false));

-- anon ללא גישה כלל; authenticated מצומצם ל-select+insert (הטבלה append-only מבחינה מכוונת).
grant select, insert on public.risk_predictions to authenticated;
grant usage, select on sequence public.risk_predictions_id_seq to authenticated;

-- "סיכון נוכחי" = תחזית האחרונה שעדיין לא פגה תוקף, לכל מטופל (distinct on).
-- security_invoker=true הכרחי: בלעדיו ה-view עוקף RLS (ERROR ב-get_advisors).
create view public.current_patient_risk
with (security_invoker = true)
as
select distinct on (patient_id)
  patient_id, risk_level, trend, confidence, probability, predicted_at, expires_at, prediction_horizon_hours, visit_report_id
from public.risk_predictions
where expires_at > now()
order by patient_id, predicted_at desc;

grant select on public.current_patient_risk to authenticated;
