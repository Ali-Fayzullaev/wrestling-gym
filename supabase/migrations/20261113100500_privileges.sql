-- Table and function privileges. RLS decides which rows; these grants decide which statements are
-- possible at all. Supabase grants ALL to anon and authenticated by default; here that is narrowed:
--   * anon gets nothing (clients never sign in);
--   * authenticated gets only the statements some policy allows, so a forbidden UPDATE/DELETE on an
--     append-only table fails with "permission denied" instead of silently touching zero rows;
--   * TRUNCATE (which bypasses RLS and row triggers) is revoked from both.
-- service_role keeps its grants; append-only triggers still stop it.

revoke all on all tables in schema public from anon, authenticated;
revoke all on all functions in schema public from public, anon, authenticated;

alter default privileges for role postgres in schema public revoke all on tables from anon;
alter default privileges for role postgres in schema public revoke all on sequences from anon;
alter default privileges for role postgres in schema public
  revoke execute on functions from public, anon;

-- INSERT/UPDATE are granted per column: timestamps (created_at, opened_at, updated_at) always come
-- from the server clock. Otherwise a caller could, for example, date their own payment in 2099 and
-- keep it inside the 10-minute "cancel right away" window forever.
grant select on public.staff to authenticated;
grant insert (id, full_name, role, active) on public.staff to authenticated;
grant update (full_name, role, active) on public.staff to authenticated;

grant select on public.groups to authenticated;
grant insert (id, name, coach_id, schedule, default_price, capacity, archived_at)
  on public.groups to authenticated;
grant update (name, coach_id, schedule, default_price, capacity, archived_at)
  on public.groups to authenticated;

grant select, delete on public.clients to authenticated;
grant insert (
  id, last_name, first_name, birth_date, phone, phone_owner, parent_name, group_id, started_on,
  note, archived_at, created_by
) on public.clients to authenticated;
grant update (
  last_name, first_name, birth_date, phone, phone_owner, parent_name, group_id, started_on, note,
  archived_at
) on public.clients to authenticated;

grant select on public.consents to authenticated;
grant insert (id, client_id, kind, given_on, recorded_by) on public.consents to authenticated;

grant select on public.payments to authenticated;
grant insert (
  id, client_id, kind, amount, method, period_start, period_end, reverses_id, reason,
  idempotency_key, created_by
) on public.payments to authenticated;

grant select on public.reminder_events to authenticated;
grant insert (id, client_id, payment_id, kind, status, template_id, opened_by)
  on public.reminder_events to authenticated;
grant update (status, marked_sent_by, marked_sent_at) on public.reminder_events to authenticated;

grant select on public.message_templates to authenticated;
grant insert (id, name, kind, body, updated_by) on public.message_templates to authenticated;
grant update (name, kind, body, updated_by) on public.message_templates to authenticated;

grant select on public.settings to authenticated;
grant update (gym_name, gym_whatsapp, reminder_days) on public.settings to authenticated;

grant select on public.audit_log to authenticated;
grant insert (id, actor_id, action, entity, entity_id, details) on public.audit_log to authenticated;

grant select on public.client_status_v to authenticated;

grant execute on function public.current_staff_role() to authenticated, service_role;
grant execute on function public.is_own_recent_payment(uuid) to authenticated, service_role;
grant execute on function public.normalize_search(text) to authenticated, service_role;
grant execute on function public.client_status(date) to authenticated, service_role;
grant execute on function public.reminder_kind_for(integer, integer[]) to authenticated, service_role;
grant execute on function public.dashboard_counts(date) to authenticated, service_role;
