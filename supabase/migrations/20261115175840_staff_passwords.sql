-- Staff passwords without email (step 15, D-14).
--
-- The owner sets a temporary password for a new employee or for one who forgot theirs, and hands
-- it over in person. Until the employee replaces it with their own, must_change_password is true
-- and the database treats them as having no role at all: current_staff_role() returns null, so
-- every policy and every function refuses, whatever the app does. Only two paths are open to such
-- a session: current_staff_access() (to tell "change your password" from "no access") and the
-- server's service_role call complete_password_change() after Auth has accepted a new password.
--
-- Nobody changes the flag through the table: authenticated has no column privilege on it, only
-- the functions below set or clear it.

alter table public.staff
  add column must_change_password boolean not null default false;

comment on column public.staff.must_change_password is
  'Temporary password set by an owner: no access until the employee sets their own.';

-- Active staff with a temporary password have no role until they change it.
create or replace function public.current_staff_role()
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select s.role
  from public.staff s
  where s.id = (select auth.uid())
    and s.active
    and not s.must_change_password;
$$;

comment on function public.current_staff_role() is
  'owner | admin for the signed-in active employee with their own password, otherwise null.';

-- What the proxy and the sign-in need: the role of an active employee and whether they still have
-- to replace a temporary password. Null for guests and inactive or unknown users.
create function public.current_staff_access()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object('role', s.role, 'must_change_password', s.must_change_password)
  from public.staff s
  where s.id = (select auth.uid())
    and s.active;
$$;

comment on function public.current_staff_access() is
  'Role and must_change_password of the signed-in active employee, otherwise null.';

-- Audit catalog: the owner set a temporary password. The password itself is never recorded.
alter table public.audit_log drop constraint audit_log_action_known;
alter table public.audit_log
  add constraint audit_log_action_known check (
    action in (
      'staff.login',
      'staff.password_change',
      'staff.password_reset',
      'staff.invite',
      'staff.role_change',
      'staff.deactivate',
      'staff.activate',
      'client.create',
      'client.update',
      'client.archive',
      'client.restore',
      'client.delete',
      'client.move',
      'client.import',
      'group.create',
      'group.update',
      'group.archive',
      'payment.create',
      'payment.cancel',
      'payment.reverse',
      'settings.update',
      'template.update',
      'report.export'
    )
  );

-- The staff row of a user the server has just created with the owner's temporary password.
-- Security definer because the flag has no column privilege for authenticated; the owner role is
-- checked here instead of by the insert policy.
create or replace function public.add_staff(p_id uuid, p_full_name text, p_role text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform public.require_staff_role(array['owner']);
  insert into public.staff (id, full_name, role, must_change_password)
  values (p_id, btrim(p_full_name), p_role, true);
  perform public.write_audit('staff.invite', 'staff', p_id, jsonb_build_object('role', p_role));
end;
$$;

-- Before the server gives an employee a new temporary password: from now on they must change it,
-- and every open session of theirs ends (a lost phone keeps no access). The owner does not reset
-- their own password here; they change it like anyone else, knowing the current one.
-- Same lock and order as update_staff_access: the caller's role is checked after the lock.
create function public.begin_password_reset(p_staff_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('staff:owners', 0));
  perform public.require_staff_role(array['owner']);
  if p_staff_id = (select auth.uid()) then
    raise exception 'self_change' using errcode = 'P0001';
  end if;
  update public.staff set must_change_password = true where id = p_staff_id;
  if not found then
    raise exception 'staff_not_found' using errcode = 'P0002';
  end if;
  delete from auth.sessions where user_id = p_staff_id;
  perform public.write_audit('staff.password_reset', 'staff', p_staff_id, '{}'::jsonb);
end;
$$;

-- Called by the server (service_role) right after Auth has set the employee's own password in
-- their session: lifts the temporary-password lock and records the change as theirs. The caller
-- must be service_role because the employee has no role while the flag is set.
create function public.complete_password_change(p_staff_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.staff set must_change_password = false where id = p_staff_id;
  insert into public.audit_log (actor_id, action, entity, entity_id, details)
  values (p_staff_id, 'staff.password_change', 'staff', p_staff_id, '{}'::jsonb);
end;
$$;

-- Staff for the owner's screen: `invited` (never signed in) gives way to the temporary password,
-- which is what the owner now needs to know.
create or replace function public.staff_screen()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform public.require_staff_role(array['owner']);
  return (
    select coalesce(
      jsonb_agg(
        jsonb_build_object(
          'id', s.id,
          'full_name', s.full_name,
          'role', s.role,
          'active', s.active,
          'email', u.email,
          'must_change_password', s.must_change_password
        )
        order by s.active desc, s.role = 'owner' desc, s.full_name
      ),
      '[]'::jsonb
    )
    from public.staff s
    join auth.users u on u.id = s.id
  );
end;
$$;

revoke all on function public.current_staff_access() from public, anon;
grant execute on function public.current_staff_access() to authenticated, service_role;
revoke all on function public.begin_password_reset(uuid) from public, anon;
grant execute on function public.begin_password_reset(uuid) to authenticated, service_role;
revoke all on function public.complete_password_change(uuid) from public, anon, authenticated;
grant execute on function public.complete_password_change(uuid) to service_role;
