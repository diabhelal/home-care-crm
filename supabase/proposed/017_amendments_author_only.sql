-- PROPOSED, NOT APPLIED to the live project. Review -> isolated-Postgres tests -> get_advisors -> apply_migration
-- (then copy to supabase/migrations/ under the exact registered version name; see supabase/proposed/APPLIED.md).
-- One additive column (previous_values), one function replaced (visit_report_amendments_guard from 012), two INSERT policies
-- replaced by one. No row is changed or deleted; SELECT policies and grants untouched.
-- Depends on: 012 (visit_report_amendments), 016 (visit_reports.author_user_id / author_role / locked_at), 015.
--
-- OWNER RULES: (2) ONLY the original author may correct their documentation - a staff member is the highest clinical authority,
-- an administrator may NOT amend someone else's clinical content; (3) a correction is an immutable amendment that keeps the
-- original and records who, when, why and WHAT changed (previous values); (6) a deactivated author's rights are not inherited.
--
-- Problem (evidence, 012): the guard let "the assigned staff member OR any administrator" amend any report, and
-- admin_insert_visit_report_amendments gave administrators a blanket INSERT policy. After 016 a manager who documented a visit
-- IS the author, so the assigned nurse is no longer the right person either. 012 stored only the new values, not what they replaced.
--
-- What changes:
--   1. amendment allowed only when auth.uid() = visit_reports.author_user_id AND the author is still an authorised account:
--      author_role 'admin' => the caller must still hold the admin claim; otherwise an ACTIVE medical_staff row linked to that login.
--      A deactivated author cannot amend, nobody else can (no inheritance, admin included); a legacy report with no known author
--      (author_user_id NULL) cannot be amended through the application - owner decision per case.
--   2. only a LOCKED report (locked_at set by complete_visit) is amended; drafts are still edited directly by their author.
--   3. previous_values (new column, server-captured, client value ignored): for every corrected key the value in force immediately
--      before this amendment (the latest earlier amendment of that key, else the original report value). The report row is locked
--      FOR UPDATE meanwhile, so two simultaneous amendments chain correctly. amended_by / amended_by_role / created_at are server-set;
--      the reason (3..2000 chars) stays mandatory.
--   4. RLS: admin_insert_ and staff_insert_own_ policies replaced by author_insert_visit_report_amendments (author_user_id =
--      auth.uid()). SELECT policies are unchanged: admin, assigned staff and the patient still read the full history.
--
-- NOT changed: amendments remain append-only (no UPDATE/DELETE); the original report is never touched; nothing is deleted.
-- LIMITATION: the DB owner / service_role (no auth.uid()) is not restricted, as in 005-016.
--
-- Reverse SQL (executable: docs/STAGING_PLAN.md ROLLBACK 017): drop the policy author_insert_visit_report_amendments, re-run the two
-- policies of 012 and the function of 012_visit_report_amendments.sql, then
--   alter table public.visit_report_amendments drop column previous_values;   -- loses the captured previous values

alter table public.visit_report_amendments
  add column if not exists previous_values jsonb not null default '{}'::jsonb;

create or replace function public.visit_report_amendments_guard()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  r      public.visit_reports;
  k      text;
  val    jsonb;
  n      numeric;
  prev   jsonb := '{}'::jsonb;
  v_prev jsonb;
begin
  if tg_op in ('UPDATE','DELETE') then
    if auth.uid() is not null then
      raise exception 'amendments are append-only' using errcode = '42501';
    end if;
    return coalesce(new, old);
  end if;

  select * into r from public.visit_reports where id = new.visit_report_id for update;
  if not found then
    raise exception 'visit report not found' using errcode = '23503';
  end if;
  if auth.uid() is null then
    return new;
  end if;

  -- original author only
  if r.author_user_id is null or r.author_user_id is distinct from auth.uid() then
    raise exception 'only the author of a visit report may amend it' using errcode = '42501';
  end if;
  if r.author_role = 'admin' then
    if not public._is_jwt_admin() then
      raise exception 'the author no longer holds an authorised account' using errcode = '42501';
    end if;
  elsif not exists (select 1 from public.medical_staff s where s.auth_user_id = auth.uid() and s.is_active) then
    raise exception 'the author is deactivated; nobody may amend in their place' using errcode = '42501';
  end if;
  if r.locked_at is null then
    raise exception 'the report is still a draft; edit it directly' using errcode = '55000';
  end if;

  new.patient_id      := r.patient_id;
  new.amended_by      := auth.uid();
  new.amended_by_role := r.author_role;
  new.created_at      := now();

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

    -- value in force before this amendment: latest earlier amendment of the key, else the original report value
    select a.corrections -> k into v_prev
      from public.visit_report_amendments a
     where a.visit_report_id = new.visit_report_id and a.corrections ? k
     order by a.id desc limit 1;
    prev := prev || jsonb_build_object(k, coalesce(v_prev, to_jsonb(r) -> k, 'null'::jsonb));
  end loop;
  new.previous_values := prev;
  return new;
end;
$$;
revoke all on function public.visit_report_amendments_guard() from public, anon, authenticated;

drop policy if exists admin_insert_visit_report_amendments on public.visit_report_amendments;
drop policy if exists staff_insert_own_visit_report_amendments on public.visit_report_amendments;
drop policy if exists author_insert_visit_report_amendments on public.visit_report_amendments;
create policy author_insert_visit_report_amendments on public.visit_report_amendments for insert to authenticated
  with check (exists (select 1 from public.visit_reports vr
                       where vr.id = visit_report_id and vr.author_user_id = (select auth.uid())));
