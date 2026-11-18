-- Client screens and client changes (step 06).
--
-- Reads: each screen gets its data from one function call (plus the role check every screen does).
-- Status comes from client_status(), the single source of subscription status.
-- Writes: functions, so the change, its consents and its audit row commit together or not at all.
-- They run as the caller (security invoker) so RLS and grants still decide, except delete_client:
-- it removes or blanks a client, which no employee may do by a direct statement.

-- A deleted client that still has payments, consents or reminders is blanked instead of removed:
-- those rows are append-only and keep pointing at it. deleted_at marks such a row.
alter table public.clients add column deleted_at timestamptz;

comment on column public.clients.deleted_at is
  'Set by delete_client() when the personal data were blanked because history rows remain.';

alter table public.clients
  add constraint clients_deleted_is_archived check (deleted_at is null or archived_at is not null);

-- Nobody edits a blanked client back into a person. Staff have no grant on deleted_at, so only
-- delete_client() sets it.
alter policy clients_update on public.clients
  using ((select public.current_staff_role()) in ('owner', 'admin') and deleted_at is null)
  with check ((select public.current_staff_role()) in ('owner', 'admin'));

-- Duplicate phone warning on the client form.
create index clients_phone_idx on public.clients (phone);

-- Reads ------------------------------------------------------------------------------------------

-- The /clients screen: up to p_limit clients with status (narrow fields: search, filters and sorting
-- run in the browser), all groups (names of archived ones are still shown on their clients), and
-- the coaches of active groups for the coach filter. `total` tells the screen if the list was cut.
create function public.clients_screen(
  p_today date default (now() at time zone 'Asia/Almaty')::date,
  p_limit integer default 500
)
returns jsonb
language sql
stable
set search_path = ''
as $$
  with listed as (
    select c.id, c.last_name, c.first_name, c.phone, c.group_id, c.archived_at, cs.status, cs.ends_on
    from public.clients c
    join public.client_status(p_today) cs on cs.client_id = c.id
    where c.deleted_at is null
    order by lower(c.last_name), lower(c.first_name), c.id
    limit greatest(p_limit, 0)
  )
  select jsonb_build_object(
    'total', (select count(*)::integer from public.clients c where c.deleted_at is null),
    'clients', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'id', l.id,
          'last_name', l.last_name,
          'first_name', l.first_name,
          'phone', l.phone,
          'group_id', l.group_id,
          'archived', l.archived_at is not null,
          'status', l.status,
          'ends_on', l.ends_on
        )
        order by lower(l.last_name), lower(l.first_name), l.id
      )
      from listed l
    ), '[]'::jsonb),
    'groups', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'id', g.id,
          'name', g.name,
          'coach_id', g.coach_id,
          'archived', g.archived_at is not null
        )
        order by lower(g.name), g.id
      )
      from public.groups g
    ), '[]'::jsonb),
    'coaches', coalesce((
      select jsonb_agg(jsonb_build_object('id', s.id, 'name', s.full_name) order by s.full_name, s.id)
      from public.staff s
      where exists (
        select 1 from public.groups g where g.coach_id = s.id and g.archived_at is null
      )
    ), '[]'::jsonb)
  );
$$;

comment on function public.clients_screen(date, integer) is
  'The clients list in one call: clients with status (at most p_limit), groups, coaches, total.';

-- The /clients/[id] screen and its edit form: the client, group, current subscription, consents
-- and the active groups to choose from. Null when there is no such client (or it was deleted).
create function public.client_screen(
  p_client_id uuid,
  p_today date default (now() at time zone 'Asia/Almaty')::date
)
returns jsonb
language sql
stable
set search_path = ''
as $$
  select jsonb_build_object(
    'client', jsonb_build_object(
      'id', c.id,
      'last_name', c.last_name,
      'first_name', c.first_name,
      'birth_date', c.birth_date,
      'phone', c.phone,
      'phone_owner', c.phone_owner,
      'parent_name', c.parent_name,
      'group_id', c.group_id,
      'started_on', c.started_on,
      'note', c.note,
      'archived', c.archived_at is not null
    ),
    'group', case when g.id is null then null else jsonb_build_object(
      'id', g.id,
      'name', g.name,
      'coach_name', s.full_name,
      'archived', g.archived_at is not null
    ) end,
    'subscription', jsonb_build_object(
      'status', cs.status,
      'period_start', cs.period_start,
      'ends_on', cs.ends_on,
      'days_left', cs.days_left
    ),
    'consents', coalesce((
      select jsonb_agg(
        jsonb_build_object('kind', k.kind, 'given_on', k.given_on, 'recorded_by', rs.full_name)
        order by k.created_at, k.id
      )
      from public.consents k
      join public.staff rs on rs.id = k.recorded_by
      where k.client_id = c.id
    ), '[]'::jsonb),
    'groups', coalesce((
      select jsonb_agg(jsonb_build_object('id', ag.id, 'name', ag.name) order by lower(ag.name), ag.id)
      from public.groups ag
      where ag.archived_at is null
    ), '[]'::jsonb)
  )
  from public.clients c
  join public.client_status(p_today) cs on cs.client_id = c.id
  left join public.groups g on g.id = c.group_id
  left join public.staff s on s.id = g.coach_id
  where c.id = p_client_id
    and c.deleted_at is null;
$$;

comment on function public.client_screen(uuid, date) is
  'Everything one client''s card and edit form need in one call; null when there is no such client.';

-- Other clients with this phone (brothers share a parent's number): the form warns, never refuses.
create function public.phone_duplicates(p_phone text, p_exclude_id uuid default null)
returns jsonb
language sql
stable
set search_path = ''
as $$
  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'id', c.id,
        'last_name', c.last_name,
        'first_name', c.first_name,
        'archived', c.archived_at is not null
      )
      order by lower(c.last_name), lower(c.first_name), c.id
    ),
    '[]'::jsonb
  )
  from public.clients c
  where c.phone = p_phone
    and c.deleted_at is null
    and c.id is distinct from p_exclude_id;
$$;

-- Writes -----------------------------------------------------------------------------------------

-- A client may be put into an active group only; one already in an archived group may stay there.
create function public.check_client_group(p_group_id uuid, p_current_group_id uuid default null)
returns void
language plpgsql
stable
set search_path = ''
as $$
begin
  if p_group_id is null or p_group_id is not distinct from p_current_group_id then
    return;
  end if;
  if not exists (
    select 1 from public.groups g where g.id = p_group_id and g.archived_at is null
  ) then
    raise exception 'group_not_found' using errcode = 'P0002';
  end if;
end;
$$;

-- Consents are recorded as given today by the caller; ones already on file are not repeated.
-- Only the fact, date and recorder. D-10: dropped in step 23 (*_remove_consents.sql).
create function public.add_client_consents(p_client_id uuid, p_kinds text[])
returns text[]
language plpgsql
set search_path = ''
as $$
declare
  v_added text[];
begin
  with added as (
    insert into public.consents (client_id, kind, given_on, recorded_by)
    select p_client_id, k.kind, (now() at time zone 'Asia/Almaty')::date, (select auth.uid())
    from (select distinct u.kind from unnest(coalesce(p_kinds, '{}')) as u (kind)) k
    where not exists (
      select 1 from public.consents e where e.client_id = p_client_id and e.kind = k.kind
    )
    returning kind
  )
  select coalesce(array_agg(a.kind order by a.kind), '{}') into v_added from added a;
  return v_added;
end;
$$;

create function public.create_client(
  p_last_name text,
  p_first_name text,
  p_phone text,
  p_phone_owner text,
  p_started_on date,
  p_birth_date date default null,
  p_parent_name text default null,
  p_group_id uuid default null,
  p_note text default '',
  p_consents text[] default '{}'
)
returns uuid
language plpgsql
set search_path = ''
as $$
declare
  v_id uuid;
  v_consents text[];
begin
  perform public.require_staff_role(array['owner', 'admin']);
  perform public.check_client_group(p_group_id);

  insert into public.clients (
    last_name, first_name, birth_date, phone, phone_owner, parent_name, group_id, started_on, note,
    created_by
  ) values (
    btrim(p_last_name),
    btrim(p_first_name),
    p_birth_date,
    p_phone,
    p_phone_owner,
    case when p_phone_owner = 'parent' then nullif(btrim(p_parent_name), '') end,
    p_group_id,
    p_started_on,
    coalesce(p_note, ''),
    (select auth.uid())
  )
  returning id into v_id;

  v_consents := public.add_client_consents(v_id, p_consents);

  -- Ids and consent kinds only: the audit log never holds names or phones.
  insert into public.audit_log (actor_id, action, entity, entity_id, details)
  values (
    (select auth.uid()), 'client.create', 'client', v_id,
    jsonb_build_object('group_id', p_group_id, 'consents', to_jsonb(v_consents))
  );
  return v_id;
end;
$$;

create function public.update_client(
  p_client_id uuid,
  p_last_name text,
  p_first_name text,
  p_phone text,
  p_phone_owner text,
  p_started_on date,
  p_birth_date date default null,
  p_parent_name text default null,
  p_group_id uuid default null,
  p_note text default '',
  p_consents text[] default '{}'
)
returns void
language plpgsql
set search_path = ''
as $$
declare
  v_old public.clients;
  v_new public.clients;
  v_fields text[] := '{}';
  v_consents text[];
begin
  perform public.require_staff_role(array['owner', 'admin']);
  select * into v_old from public.clients c where c.id = p_client_id for update;
  if not found or v_old.deleted_at is not null then
    raise exception 'client_not_found' using errcode = 'P0002';
  end if;
  perform public.check_client_group(p_group_id, v_old.group_id);

  update public.clients
  set last_name = btrim(p_last_name),
      first_name = btrim(p_first_name),
      birth_date = p_birth_date,
      phone = p_phone,
      phone_owner = p_phone_owner,
      parent_name = case when p_phone_owner = 'parent' then nullif(btrim(p_parent_name), '') end,
      group_id = p_group_id,
      started_on = p_started_on,
      note = coalesce(p_note, '')
  where id = p_client_id
  returning * into v_new;

  -- Field names only: the audit log never holds the values.
  if v_old.last_name is distinct from v_new.last_name then
    v_fields := array_append(v_fields, 'last_name');
  end if;
  if v_old.first_name is distinct from v_new.first_name then
    v_fields := array_append(v_fields, 'first_name');
  end if;
  if v_old.birth_date is distinct from v_new.birth_date then
    v_fields := array_append(v_fields, 'birth_date');
  end if;
  if v_old.phone is distinct from v_new.phone then
    v_fields := array_append(v_fields, 'phone');
  end if;
  if v_old.phone_owner is distinct from v_new.phone_owner then
    v_fields := array_append(v_fields, 'phone_owner');
  end if;
  if v_old.parent_name is distinct from v_new.parent_name then
    v_fields := array_append(v_fields, 'parent_name');
  end if;
  if v_old.group_id is distinct from v_new.group_id then
    v_fields := array_append(v_fields, 'group_id');
  end if;
  if v_old.started_on is distinct from v_new.started_on then
    v_fields := array_append(v_fields, 'started_on');
  end if;
  if v_old.note is distinct from v_new.note then
    v_fields := array_append(v_fields, 'note');
  end if;

  v_consents := public.add_client_consents(p_client_id, p_consents);

  if cardinality(v_fields) > 0 or cardinality(v_consents) > 0 then
    insert into public.audit_log (actor_id, action, entity, entity_id, details)
    values (
      (select auth.uid()), 'client.update', 'client', p_client_id,
      jsonb_build_object(
        'fields', to_jsonb(v_fields),
        'consents', to_jsonb(v_consents),
        'from_group_id', case when 'group_id' = any (v_fields) then v_old.group_id end,
        'to_group_id', case when 'group_id' = any (v_fields) then v_new.group_id end
      )
    );
  end if;
end;
$$;

-- Archives or brings back a client. Doing what is already done changes nothing and logs nothing.
create function public.set_client_archived(p_client_id uuid, p_archived boolean)
returns boolean
language plpgsql
set search_path = ''
as $$
declare
  v_client public.clients;
begin
  perform public.require_staff_role(array['owner', 'admin']);
  select * into v_client from public.clients c where c.id = p_client_id for update;
  if not found or v_client.deleted_at is not null then
    raise exception 'client_not_found' using errcode = 'P0002';
  end if;
  if (v_client.archived_at is not null) = p_archived then
    return false;
  end if;

  update public.clients
  set archived_at = case when p_archived then now() end
  where id = p_client_id;
  insert into public.audit_log (actor_id, action, entity, entity_id)
  values (
    (select auth.uid()),
    case when p_archived then 'client.archive' else 'client.restore' end,
    'client',
    p_client_id
  );
  return true;
end;
$$;

-- Full deletion, owner only, after typing the client's last name and choosing a reason from a fixed
-- list (free text could carry personal data into the audit log). Payments, consents and reminders
-- are append-only and must stay, so a client with any of them is blanked (deleted_at) instead of
-- removed: the personal data are gone, the money history remains.
-- SECURITY DEFINER: staff have no grant on deleted_at and admins may not delete; the role check
-- below is the gate.
create function public.delete_client(p_client_id uuid, p_reason text, p_last_name text)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_client public.clients;
  v_mode text;
begin
  perform public.require_staff_role(array['owner']);
  if p_reason is null
     or p_reason not in ('duplicate', 'created_by_mistake', 'client_request', 'other') then
    raise exception 'invalid_reason' using errcode = '22023';
  end if;

  select * into v_client from public.clients c where c.id = p_client_id for update;
  if not found or v_client.deleted_at is not null then
    raise exception 'client_not_found' using errcode = 'P0002';
  end if;
  if lower(btrim(coalesce(p_last_name, ''))) <> lower(btrim(v_client.last_name)) then
    raise exception 'confirmation_mismatch' using errcode = '22023';
  end if;

  if exists (select 1 from public.payments p where p.client_id = p_client_id)
     or exists (select 1 from public.consents k where k.client_id = p_client_id)
     or exists (select 1 from public.reminder_events r where r.client_id = p_client_id) then
    v_mode := 'anonymized';
    update public.clients
    set last_name = '—',
        first_name = '—',
        birth_date = null,
        phone = '+77000000000',
        phone_owner = 'self',
        parent_name = null,
        group_id = null,
        note = '',
        archived_at = coalesce(archived_at, now()),
        deleted_at = now()
    where id = p_client_id;
  else
    v_mode := 'deleted';
    delete from public.clients where id = p_client_id;
  end if;

  insert into public.audit_log (actor_id, action, entity, entity_id, details)
  values (
    (select auth.uid()), 'client.delete', 'client', p_client_id,
    jsonb_build_object('mode', v_mode, 'reason', p_reason)
  );
  return v_mode;
end;
$$;

grant execute on function public.clients_screen(date, integer) to authenticated, service_role;
grant execute on function public.client_screen(uuid, date) to authenticated, service_role;
grant execute on function public.phone_duplicates(text, uuid) to authenticated, service_role;
grant execute on function public.check_client_group(uuid, uuid) to authenticated, service_role;
grant execute on function public.add_client_consents(uuid, text[]) to authenticated, service_role;
grant execute on function public.create_client(
  text, text, text, text, date, date, text, uuid, text, text[]
) to authenticated, service_role;
grant execute on function public.update_client(
  uuid, text, text, text, text, date, date, text, uuid, text, text[]
) to authenticated, service_role;
grant execute on function public.set_client_archived(uuid, boolean) to authenticated, service_role;
grant execute on function public.delete_client(uuid, text, text) to authenticated, service_role;
