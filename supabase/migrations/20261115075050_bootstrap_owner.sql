-- The first owner of a new database. Everyone else is invited by an owner from the app
-- (add_staff), but on a fresh production database there is nobody to do that yet.
-- Only service_role may call it, and only while the staff table is empty: once the gym has any
-- employee, the database refuses, so a leaked server key still cannot add a second owner this way.

create function public.bootstrap_owner(p_id uuid, p_full_name text)
returns void
language plpgsql
set search_path = ''
as $$
begin
  -- The same lock as every other staff change: two parallel calls cannot both see an empty table.
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('staff:owners', 0));
  if exists (select 1 from public.staff) then
    raise exception 'already_bootstrapped' using errcode = 'P0001';
  end if;
  insert into public.staff (id, full_name, role) values (p_id, btrim(p_full_name), 'owner');
  -- No actor: nobody signed in did this. Details hold the role only, never the name.
  insert into public.audit_log (actor_id, action, entity, entity_id, details)
  values (null, 'staff.invite', 'staff', p_id, jsonb_build_object('role', 'owner'));
end;
$$;

comment on function public.bootstrap_owner(uuid, text) is
  'Creates the first owner; service_role only, refused once any staff row exists.';

revoke all on function public.bootstrap_owner(uuid, text) from public, anon, authenticated;
grant execute on function public.bootstrap_owner(uuid, text) to service_role;
