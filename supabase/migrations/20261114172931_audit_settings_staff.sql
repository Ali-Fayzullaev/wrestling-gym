-- Audit log screen, gym settings and staff management (step 12).
--
-- * audit_log.action is limited to a known catalog, so the journal can name every entry in plain
--   words. A new action needs a migration here and a label in src/features/audit/actions.ts.
-- * write_audit() is the one way new code records an action: the actor is always the caller.
-- * Staff changes go through functions that write their audit row in the same transaction; a
--   trigger keeps at least one active owner whoever updates the table.
-- Everything runs as the caller (security invoker) except staff_screen, which reads emails from
-- auth.users after checking the owner role itself.

-- Action catalog ---------------------------------------------------------------------------------

alter table public.audit_log
  add constraint audit_log_action_known check (
    action in (
      'staff.login',
      'staff.password_change',
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

-- Filtering the journal by employee walks this index newest first.
create index audit_log_actor_created_idx on public.audit_log (actor_id, created_at desc);

-- Records an action of the signed-in employee. Ids, counts and field names only in p_details:
-- never names, phones, emails or free text.
create function public.write_audit(
  p_action text,
  p_entity text,
  p_entity_id uuid default null,
  p_details jsonb default '{}'::jsonb
)
returns void
language plpgsql
set search_path = ''
as $$
begin
  perform public.require_staff_role(array['owner', 'admin']);
  insert into public.audit_log (actor_id, action, entity, entity_id, details)
  values ((select auth.uid()), p_action, p_entity, p_entity_id, coalesce(p_details, '{}'::jsonb));
end;
$$;

-- Journal ----------------------------------------------------------------------------------------

-- One page of the journal, newest first, and the employees for the filter. Cursor: the
-- (created_at, id) of the last entry already shown. Dates are Asia/Almaty days, both inclusive.
-- Names of clients, groups and staff are joined for the owner's screen only; the log rows
-- themselves hold ids.
create function public.audit_feed(
  p_actor uuid default null,
  p_action text default null,
  p_from date default null,
  p_to date default null,
  p_before_at timestamptz default null,
  p_before_id uuid default null,
  p_limit integer default 50
)
returns jsonb
language plpgsql
stable
set search_path = ''
as $$
declare
  v_limit integer := least(greatest(coalesce(p_limit, 50), 1), 100);
  v_entries jsonb;
  v_staff jsonb;
begin
  perform public.require_staff_role(array['owner']);
  if (p_before_at is null) <> (p_before_id is null) then
    raise exception 'invalid_cursor' using errcode = '22023';
  end if;

  with page as (
    select a.*
    from public.audit_log a
    where (p_actor is null or a.actor_id = p_actor)
      and (p_action is null or a.action = p_action)
      and (p_from is null or a.created_at >= (p_from::timestamp at time zone 'Asia/Almaty'))
      and (p_to is null or a.created_at < ((p_to + 1)::timestamp at time zone 'Asia/Almaty'))
      and (p_before_at is null or (a.created_at, a.id) < (p_before_at, p_before_id))
    order by a.created_at desc, a.id desc
    -- One extra row tells whether there is a next page.
    limit v_limit + 1
  )
  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'id', p.id,
        'created_at', p.created_at,
        'actor_id', p.actor_id,
        'actor_name', actor.full_name,
        'action', p.action,
        'entity', p.entity,
        'entity_id', p.entity_id,
        'details', p.details,
        'client_id', client.id,
        'client_name', case
          when client.deleted_at is null then client.last_name || ' ' || client.first_name
        end,
        'group_name', grp.name,
        'staff_name', staff.full_name
      )
      order by p.created_at desc, p.id desc
    ),
    '[]'::jsonb
  )
  into v_entries
  from page p
  left join public.staff actor on actor.id = p.actor_id
  left join public.clients client on client.id = case
    when p.entity = 'client' then p.entity_id
    when p.details ? 'client_id' then (p.details ->> 'client_id')::uuid
  end
  left join public.groups grp on p.entity = 'group' and grp.id = p.entity_id
  left join public.staff staff on p.entity = 'staff' and staff.id = p.entity_id;

  select coalesce(
    jsonb_agg(jsonb_build_object('id', s.id, 'name', s.full_name) order by s.full_name),
    '[]'::jsonb
  )
  into v_staff
  from public.staff s;

  return jsonb_build_object('entries', v_entries, 'staff', v_staff, 'limit', v_limit);
end;
$$;

-- Gym settings -----------------------------------------------------------------------------------

-- Name and WhatsApp number of the gym. Only what changed is written, with one audit row listing
-- the changed fields (values stay out of the log).
create function public.update_gym_settings(p_gym_name text, p_gym_whatsapp text)
returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  v_old public.settings;
  v_name text := btrim(p_gym_name);
  v_whatsapp text := nullif(btrim(coalesce(p_gym_whatsapp, '')), '');
  v_fields text[] := '{}';
begin
  perform public.require_staff_role(array['owner']);
  select * into v_old from public.settings s where s.id for update;

  if v_old.gym_name is distinct from v_name then
    v_fields := array_append(v_fields, 'gym_name');
  end if;
  if v_old.gym_whatsapp is distinct from v_whatsapp then
    v_fields := array_append(v_fields, 'gym_whatsapp');
  end if;
  if cardinality(v_fields) = 0 then
    return jsonb_build_object('changed', false);
  end if;

  -- The table checks the length of the name and the +77XXXXXXXXX format (23514 otherwise).
  update public.settings set gym_name = v_name, gym_whatsapp = v_whatsapp where id;
  perform public.write_audit(
    'settings.update', 'settings', null, jsonb_build_object('fields', to_jsonb(v_fields))
  );
  return jsonb_build_object('changed', true);
end;
$$;

-- Staff ------------------------------------------------------------------------------------------

-- Keeps at least one active owner, whoever changes the table. The lock makes two parallel
-- demotions of the last two owners wait for each other: the second one sees the first committed.
create function public.keep_active_owner()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if old.role = 'owner' and old.active and not (new.role = 'owner' and new.active) then
    perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('staff:owners', 0));
    if not exists (
      select 1 from public.staff s
      where s.role = 'owner' and s.active and s.id <> old.id
    ) then
      raise exception 'last_owner' using errcode = 'P0001';
    end if;
  end if;
  return new;
end;
$$;

create trigger staff_keep_active_owner
  before update of role, active on public.staff
  for each row execute function public.keep_active_owner();

-- Staff for the owner's screen, with sign-in emails from auth.users (owners only: emails are
-- personal data). Owners first, then by name.
create function public.staff_screen()
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
          'invited', u.last_sign_in_at is null
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

-- The staff row of an invited user. The auth user is created first by the server with
-- service_role (invite email); this adds the employee and the audit row as the owner.
create function public.add_staff(p_id uuid, p_full_name text, p_role text)
returns void
language plpgsql
set search_path = ''
as $$
begin
  perform public.require_staff_role(array['owner']);
  insert into public.staff (id, full_name, role) values (p_id, btrim(p_full_name), p_role);
  perform public.write_audit('staff.invite', 'staff', p_id, jsonb_build_object('role', p_role));
end;
$$;

-- Role change and (de)activation. An owner does not change their own access here: handing the gym
-- over is done by another owner, so nobody locks themselves out by a mistaken tap.
-- Staff changes run one at a time (the same lock as keep_active_owner), and the caller's role is
-- checked after the lock: an owner demoted by a parallel change while waiting is refused, instead
-- of RLS silently updating nothing.
create function public.update_staff_access(p_staff_id uuid, p_role text, p_active boolean)
returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  v_old public.staff;
begin
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('staff:owners', 0));
  perform public.require_staff_role(array['owner']);
  if p_role is null or p_active is null then
    raise exception 'invalid_staff' using errcode = '22023';
  end if;
  if p_staff_id = (select auth.uid()) then
    raise exception 'self_change' using errcode = 'P0001';
  end if;

  select * into v_old from public.staff s where s.id = p_staff_id for update;
  if not found then
    raise exception 'staff_not_found' using errcode = 'P0002';
  end if;
  if v_old.role = p_role and v_old.active = p_active then
    return jsonb_build_object('changed', false);
  end if;

  -- keep_active_owner raises last_owner here when this would leave no active owner.
  update public.staff set role = p_role, active = p_active where id = p_staff_id;
  if not found then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  if v_old.role <> p_role then
    perform public.write_audit(
      'staff.role_change', 'staff', p_staff_id,
      jsonb_build_object('from', v_old.role, 'to', p_role)
    );
  end if;
  if v_old.active <> p_active then
    perform public.write_audit(
      case when p_active then 'staff.activate' else 'staff.deactivate' end,
      'staff', p_staff_id, '{}'::jsonb
    );
  end if;
  return jsonb_build_object('changed', true);
end;
$$;

grant execute on function public.write_audit(text, text, uuid, jsonb) to authenticated, service_role;
grant execute on function public.audit_feed(uuid, text, date, date, timestamptz, uuid, integer)
  to authenticated, service_role;
grant execute on function public.update_gym_settings(text, text) to authenticated, service_role;
grant execute on function public.staff_screen() to authenticated, service_role;
grant execute on function public.add_staff(uuid, text, text) to authenticated, service_role;
grant execute on function public.update_staff_access(uuid, text, boolean)
  to authenticated, service_role;
