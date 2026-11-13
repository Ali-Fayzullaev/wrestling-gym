-- Group screens and group changes (step 05).
--
-- Reads: each screen gets everything it needs from one function call, so a screen costs two
-- database requests in total (the role check plus this). Counts come from client_status(), the
-- single source of subscription status.
-- Writes: functions, so the change and its audit row commit together or not at all.
-- Everything runs as the caller (security invoker): RLS and grants still decide. The explicit role
-- checks only turn a refusal into a clear error before any row is touched.

-- Raises insufficient_privilege unless the caller is active staff with one of p_roles.
create function public.require_staff_role(p_roles text[])
returns void
language plpgsql
stable
set search_path = ''
as $$
begin
  if not coalesce(public.current_staff_role() = any (p_roles), false) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
end;
$$;

-- Head counts per group on p_today. Archived clients are not counted.
--   paid    = the subscription is valid today (active or expiring);
--   debtors = it has ended (expired);
--   unpaid  = never paid (none).
create function public.group_counts(
  p_today date default (now() at time zone 'Asia/Almaty')::date
)
returns table (
  group_id uuid,
  members integer,
  paid integer,
  expiring integer,
  debtors integer,
  unpaid integer
)
language sql
stable
set search_path = ''
as $$
  select
    c.group_id,
    count(*)::integer,
    count(*) filter (where cs.status in ('active', 'expiring'))::integer,
    count(*) filter (where cs.status = 'expiring')::integer,
    count(*) filter (where cs.status = 'expired')::integer,
    count(*) filter (where cs.status = 'none')::integer
  from public.client_status(p_today) cs
  join public.clients c on c.id = cs.client_id
  where c.archived_at is null
    and c.group_id is not null
  group by c.group_id;
$$;

comment on function public.group_counts(date) is
  'Per group on p_today: members, paid (active+expiring), expiring, debtors (expired), unpaid (none).';

-- Employees who can be chosen as coach: active staff, plus the current coach of the group being
-- edited even if they have since been deactivated (so the form can show who it is).
create function public.coach_options(p_keep_id uuid default null)
returns jsonb
language sql
stable
set search_path = ''
as $$
  select coalesce(
    jsonb_agg(jsonb_build_object('id', s.id, 'name', s.full_name) order by s.full_name, s.id),
    '[]'::jsonb
  )
  from public.staff s
  where s.active or s.id = p_keep_id;
$$;

-- The /groups screen: active groups with coach and counts, and the coach list for the owner's form.
create function public.groups_screen(
  p_today date default (now() at time zone 'Asia/Almaty')::date
)
returns jsonb
language sql
stable
set search_path = ''
as $$
  with counts as (
    select * from public.group_counts(p_today)
  )
  select jsonb_build_object(
    'groups', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'id', g.id,
          'name', g.name,
          'coach_id', g.coach_id,
          'coach_name', s.full_name,
          'schedule', g.schedule,
          'default_price', g.default_price,
          'capacity', g.capacity,
          'members', coalesce(gc.members, 0),
          'paid', coalesce(gc.paid, 0),
          'expiring', coalesce(gc.expiring, 0),
          'debtors', coalesce(gc.debtors, 0),
          'unpaid', coalesce(gc.unpaid, 0)
        )
        order by lower(g.name), g.id
      )
      from public.groups g
      join public.staff s on s.id = g.coach_id
      left join counts gc on gc.group_id = g.id
      where g.archived_at is null
    ), '[]'::jsonb),
    'coaches', public.coach_options(null)
  );
$$;

comment on function public.groups_screen(date) is
  'Everything the groups list needs in one call: active groups with counts, and coach options.';

-- The /groups/[id] screen: the group with counts, its active clients with status, the groups they
-- can be moved to, and coach options. Null when the group does not exist (or is not visible).
create function public.group_screen(
  p_group_id uuid,
  p_today date default (now() at time zone 'Asia/Almaty')::date
)
returns jsonb
language sql
stable
set search_path = ''
as $$
  with counts as (
    select * from public.group_counts(p_today)
  )
  select jsonb_build_object(
    'group', jsonb_build_object(
      'id', g.id,
      'name', g.name,
      'coach_id', g.coach_id,
      'coach_name', s.full_name,
      'schedule', g.schedule,
      'default_price', g.default_price,
      'capacity', g.capacity,
      'archived', g.archived_at is not null,
      'members', coalesce(gc.members, 0),
      'paid', coalesce(gc.paid, 0),
      'expiring', coalesce(gc.expiring, 0),
      'debtors', coalesce(gc.debtors, 0),
      'unpaid', coalesce(gc.unpaid, 0)
    ),
    'members', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'id', c.id,
          'last_name', c.last_name,
          'first_name', c.first_name,
          'status', cs.status,
          'ends_on', cs.ends_on
        )
        order by lower(c.last_name), lower(c.first_name), c.id
      )
      from public.clients c
      join public.client_status(p_today) cs on cs.client_id = c.id
      where c.group_id = g.id
        and c.archived_at is null
    ), '[]'::jsonb),
    'targets', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'id', t.id,
          'name', t.name,
          'capacity', t.capacity,
          'members', coalesce(tc.members, 0)
        )
        order by lower(t.name), t.id
      )
      from public.groups t
      left join counts tc on tc.group_id = t.id
      where t.archived_at is null
        and t.id <> g.id
    ), '[]'::jsonb),
    'coaches', public.coach_options(g.coach_id)
  )
  from public.groups g
  join public.staff s on s.id = g.coach_id
  left join counts gc on gc.group_id = g.id
  where g.id = p_group_id;
$$;

comment on function public.group_screen(uuid, date) is
  'Everything one group''s screen needs in one call; null when there is no such group.';

-- A coach must be an active employee; when editing, the group's current coach may stay as is.
create function public.check_coach(p_coach_id uuid, p_current_coach_id uuid default null)
returns void
language plpgsql
stable
set search_path = ''
as $$
begin
  if not exists (
    select 1 from public.staff s
    where s.id = p_coach_id and (s.active or s.id = p_current_coach_id)
  ) then
    raise exception 'coach_not_found' using errcode = 'P0002';
  end if;
end;
$$;

-- Moves into and archiving of one group run one after another, so nobody is moved into a group
-- that is being archived at the same moment.
create function public.lock_group(p_group_id uuid)
returns void
language sql
volatile
set search_path = ''
as $$
  select pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('group:' || p_group_id::text, 0)
  );
$$;

create function public.create_group(
  p_name text,
  p_coach_id uuid,
  p_schedule jsonb,
  p_default_price integer,
  -- null = no seat limit; a default so the generated client type lets it be left out
  p_capacity integer default null
)
returns uuid
language plpgsql
set search_path = ''
as $$
declare
  v_id uuid;
begin
  perform public.require_staff_role(array['owner']);
  perform public.check_coach(p_coach_id);
  insert into public.groups (name, coach_id, schedule, default_price, capacity)
  values (btrim(p_name), p_coach_id, p_schedule, p_default_price, p_capacity)
  returning id into v_id;
  insert into public.audit_log (actor_id, action, entity, entity_id)
  values ((select auth.uid()), 'group.create', 'group', v_id);
  return v_id;
end;
$$;

-- A new price applies to payments recorded from now on; past payments keep their own amount.
create function public.update_group(
  p_group_id uuid,
  p_name text,
  p_coach_id uuid,
  p_schedule jsonb,
  p_default_price integer,
  -- null = no seat limit; a default so the generated client type lets it be left out
  p_capacity integer default null
)
returns void
language plpgsql
set search_path = ''
as $$
declare
  v_old public.groups;
  v_fields text[] := '{}';
begin
  perform public.require_staff_role(array['owner']);
  select * into v_old from public.groups g where g.id = p_group_id for update;
  if not found or v_old.archived_at is not null then
    raise exception 'group_not_found' using errcode = 'P0002';
  end if;
  perform public.check_coach(p_coach_id, v_old.coach_id);

  update public.groups
  set name = btrim(p_name),
      coach_id = p_coach_id,
      schedule = p_schedule,
      default_price = p_default_price,
      capacity = p_capacity
  where id = p_group_id;

  -- Field names only: the audit log never holds the values.
  if v_old.name is distinct from btrim(p_name) then
    v_fields := array_append(v_fields, 'name');
  end if;
  if v_old.coach_id is distinct from p_coach_id then
    v_fields := array_append(v_fields, 'coach_id');
  end if;
  if v_old.schedule is distinct from p_schedule then
    v_fields := array_append(v_fields, 'schedule');
  end if;
  if v_old.default_price is distinct from p_default_price then
    v_fields := array_append(v_fields, 'default_price');
  end if;
  if v_old.capacity is distinct from p_capacity then
    v_fields := array_append(v_fields, 'capacity');
  end if;

  if cardinality(v_fields) > 0 then
    insert into public.audit_log (actor_id, action, entity, entity_id, details)
    values (
      (select auth.uid()), 'group.update', 'group', p_group_id,
      jsonb_build_object('fields', to_jsonb(v_fields))
    );
  end if;
end;
$$;

-- Archives a group. With active clients it does nothing unless p_force (the owner has seen the
-- warning); the clients then stay linked to the archived group. Archiving twice is a no-op.
create function public.archive_group(p_group_id uuid, p_force boolean)
returns table (archived boolean, active_clients integer)
language plpgsql
set search_path = ''
as $$
declare
  v_group public.groups;
  v_clients integer;
begin
  perform public.require_staff_role(array['owner']);
  perform public.lock_group(p_group_id);
  select * into v_group from public.groups g where g.id = p_group_id for update;
  if not found then
    raise exception 'group_not_found' using errcode = 'P0002';
  end if;
  if v_group.archived_at is not null then
    return query select true, 0;
    return;
  end if;

  select count(*)::integer into v_clients
  from public.clients c
  where c.group_id = p_group_id and c.archived_at is null;

  if v_clients > 0 and not coalesce(p_force, false) then
    return query select false, v_clients;
    return;
  end if;

  update public.groups set archived_at = now() where id = p_group_id;
  insert into public.audit_log (actor_id, action, entity, entity_id, details)
  values (
    (select auth.uid()), 'group.archive', 'group', p_group_id,
    jsonb_build_object('active_clients', v_clients)
  );
  return query select true, v_clients;
end;
$$;

-- Moves clients to another active group: all of them or none. One audit row per moved client.
-- Clients already in the target are left as they are. A full group is not a reason to refuse:
-- the screen warns, the function reports the new head count.
create function public.move_clients(p_client_ids uuid[], p_target_group_id uuid)
returns table (moved integer, target_members integer, target_capacity integer)
language plpgsql
set search_path = ''
as $$
declare
  v_ids uuid[];
  v_capacity integer;
  v_moved integer;
begin
  perform public.require_staff_role(array['owner', 'admin']);
  v_ids := array(select distinct u.id from unnest(p_client_ids) as u (id) where u.id is not null);
  if cardinality(v_ids) = 0 then
    raise exception 'no_clients' using errcode = '22023';
  end if;

  perform public.lock_group(p_target_group_id);
  select g.capacity into v_capacity
  from public.groups g
  where g.id = p_target_group_id and g.archived_at is null;
  if not found then
    raise exception 'target_group_not_found' using errcode = 'P0002';
  end if;

  -- Locks in id order, so two transfers of the same clients run one after another.
  perform 1 from public.clients c where c.id = any (v_ids) order by c.id for update;
  if (
    select count(*) from public.clients c where c.id = any (v_ids) and c.archived_at is null
  ) <> cardinality(v_ids) then
    raise exception 'client_not_found' using errcode = 'P0002';
  end if;

  insert into public.audit_log (actor_id, action, entity, entity_id, details)
  select
    (select auth.uid()), 'client.move', 'client', c.id,
    jsonb_build_object('from_group_id', c.group_id, 'to_group_id', p_target_group_id)
  from public.clients c
  where c.id = any (v_ids) and c.group_id is distinct from p_target_group_id;
  get diagnostics v_moved = row_count;

  update public.clients
  set group_id = p_target_group_id
  where id = any (v_ids) and group_id is distinct from p_target_group_id;

  return query
  select
    v_moved,
    (
      select count(*)::integer from public.clients c
      where c.group_id = p_target_group_id and c.archived_at is null
    ),
    v_capacity;
end;
$$;

grant execute on function public.require_staff_role(text[]) to authenticated, service_role;
grant execute on function public.group_counts(date) to authenticated, service_role;
grant execute on function public.coach_options(uuid) to authenticated, service_role;
grant execute on function public.groups_screen(date) to authenticated, service_role;
grant execute on function public.group_screen(uuid, date) to authenticated, service_role;
grant execute on function public.check_coach(uuid, uuid) to authenticated, service_role;
grant execute on function public.lock_group(uuid) to authenticated, service_role;
grant execute on function public.create_group(text, uuid, jsonb, integer, integer)
  to authenticated, service_role;
grant execute on function public.update_group(uuid, text, uuid, jsonb, integer, integer)
  to authenticated, service_role;
grant execute on function public.archive_group(uuid, boolean) to authenticated, service_role;
grant execute on function public.move_clients(uuid[], uuid) to authenticated, service_role;
