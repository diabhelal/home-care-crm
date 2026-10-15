-- APPLIED to the live project on 2026-10-15 (registered via apply_migration); source: supabase/proposed.
-- (execute_sql iteration -> get_advisors -> apply_migration -> local file with the exact registered version name).
-- Additive only; no data deletion.

-- Atomic: upsert visit_reports + bookings.status='completed' in ONE transaction
-- (a plpgsql function body is a single transaction). Vitals are re-validated by the
-- existing visit_reports CHECK constraints.
create or replace function public.complete_visit(p_booking_id bigint, p_payload jsonb)
returns public.visit_reports
language plpgsql
security definer
set search_path = public
as $$
declare
  b public.bookings;
  r public.visit_reports;
begin
  select * into b from public.bookings where id = p_booking_id for update;
  if not found then
    raise exception 'booking not found' using errcode = 'P0002';
  end if;
  -- owner (assigned staff) or an admin; identity comes from the verified JWT, never a parameter
  if b.staff_id is distinct from public.current_staff_id()
     and not coalesce((((select auth.jwt()) -> 'app_metadata') ->> 'is_admin')::boolean, false) then
    raise exception 'not your booking' using errcode = '42501';
  end if;
  if b.status <> 'scheduled' or b.approval_status <> 'confirmed' then
    raise exception 'illegal state' using errcode = '55000';
  end if;

  insert into public.visit_reports (
    booking_id, patient_id, staff_id, visit_date,
    systolic_bp, diastolic_bp, blood_sugar, pulse, temperature, oxygen_saturation,
    performed_blood_draw, performed_injection, performed_infusion,
    performed_dressing_change, performed_catheter_change,
    treatment_summary, patient_signature_data)
  values (
    b.id, b.patient_id, b.staff_id, now(),
    (p_payload->>'systolic_bp')::int, (p_payload->>'diastolic_bp')::int,
    (p_payload->>'blood_sugar')::int, (p_payload->>'pulse')::int,
    (p_payload->>'temperature')::numeric, (p_payload->>'oxygen_saturation')::int,
    coalesce((p_payload->>'performed_blood_draw')::boolean, false),
    coalesce((p_payload->>'performed_injection')::boolean, false),
    coalesce((p_payload->>'performed_infusion')::boolean, false),
    coalesce((p_payload->>'performed_dressing_change')::boolean, false),
    coalesce((p_payload->>'performed_catheter_change')::boolean, false),
    p_payload->>'treatment_summary', p_payload->>'patient_signature_data')
  on conflict (booking_id) do update set
    systolic_bp = excluded.systolic_bp, diastolic_bp = excluded.diastolic_bp,
    blood_sugar = excluded.blood_sugar, pulse = excluded.pulse,
    temperature = excluded.temperature, oxygen_saturation = excluded.oxygen_saturation,
    performed_blood_draw = excluded.performed_blood_draw,
    performed_injection = excluded.performed_injection,
    performed_infusion = excluded.performed_infusion,
    performed_dressing_change = excluded.performed_dressing_change,
    performed_catheter_change = excluded.performed_catheter_change,
    treatment_summary = excluded.treatment_summary,
    patient_signature_data = excluded.patient_signature_data
  returning * into r;

  update public.bookings
     set status = 'completed', workflow_status = 'assigned'
   where id = p_booking_id;
  return r;
end;
$$;

revoke all on function public.complete_visit(bigint, jsonb) from public, anon;
grant execute on function public.complete_visit(bigint, jsonb) to authenticated;
