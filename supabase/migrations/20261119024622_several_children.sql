-- Step 24, D-24 (2026-11-18, project owner): a parent often brings 3-4 children at once. The new
-- client form saves the parent (new or on file) and up to 10 children in one go: create_children().
--
-- Idempotency (rule 5): the form sends one request key per filling. Each child stores it with its
-- place in the list, and (request_key, request_position) is unique, so a repeated or doubled
-- request cannot add the same children twice even if the code check below were skipped.

alter table public.clients
  add column request_key uuid,
  add column request_position smallint,
  add constraint clients_request_pair
    check ((request_key is null) = (request_position is null)),
  add constraint clients_request_position
    check (request_position between 1 and 10);

create unique index clients_request_key_position
  on public.clients (request_key, request_position)
  where request_key is not null;

-- Insert only: a saved child's key is never changed.
grant insert (request_key, request_position) on public.clients to authenticated;

comment on column public.clients.request_key is
  'Request key of create_children(): repeating the request returns these children (step 24).';

-- p_children: [{"last_name", "first_name", "phone", "birth_date", "group_id", "started_on",
-- "note"}, ...], 1 to 10 of them. The parent: p_parent_id (on file, not archived) or p_new_parent
-- ({"name", "phone", "message_locale"}), exactly one. All children or none are saved. Returns
-- {"parent_id", "child_ids": [...] in the given order, "created": false on a repeat}.
-- Every argument defaults to null so a caller leaves out the kind of parent it does not send;
-- the missing ones are refused below.
create function public.create_children(
  p_parent_id uuid default null,
  p_new_parent jsonb default null,
  p_children jsonb default null,
  p_request_key uuid default null
)
returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  v_parent_id uuid;
  v_existing jsonb;
  v_child jsonb;
  v_position smallint := 0;
  v_group_id uuid;
  v_id uuid;
  v_ids uuid[] := '{}';
begin
  perform public.require_staff_role(array['owner', 'admin']);
  if p_request_key is null then
    raise exception 'invalid_request_key' using errcode = '22023';
  end if;
  if p_children is null
    or jsonb_typeof(p_children) <> 'array'
    or jsonb_array_length(p_children) not between 1 and 10
  then
    raise exception 'invalid_children' using errcode = '22023';
  end if;
  if (p_parent_id is null) = (p_new_parent is null) then
    raise exception 'invalid_parent' using errcode = '22023';
  end if;

  -- Requests with one key queue here; the later one then finds the earlier one's children (each
  -- statement below sees what was committed before it started).
  perform pg_advisory_xact_lock(hashtextextended('create_children:' || p_request_key::text, 0));
  select jsonb_build_object(
    'parent_id', (array_agg(c.parent_id))[1],
    'child_ids', jsonb_agg(c.id order by c.request_position),
    'created', false
  )
  into v_existing
  from public.clients c
  where c.request_key = p_request_key
  having count(*) > 0;
  if v_existing is not null then
    return v_existing;
  end if;

  v_parent_id := public.resolve_client_parent(p_parent_id, p_new_parent);

  for v_child in select e.value from jsonb_array_elements(p_children) e loop
    if jsonb_typeof(v_child) <> 'object' then
      raise exception 'invalid_children' using errcode = '22023';
    end if;
    v_position := v_position + 1;
    v_group_id := (v_child ->> 'group_id')::uuid;
    perform public.check_client_group(v_group_id);

    -- Names and the phone are checked by the clients constraints (23514).
    insert into public.clients (
      last_name, first_name, birth_date, phone, parent_id, group_id, started_on, note,
      created_by, request_key, request_position
    ) values (
      btrim(v_child ->> 'last_name'),
      btrim(v_child ->> 'first_name'),
      (v_child ->> 'birth_date')::date,
      v_child ->> 'phone',
      v_parent_id,
      v_group_id,
      (v_child ->> 'started_on')::date,
      coalesce(v_child ->> 'note', ''),
      (select auth.uid()),
      p_request_key,
      v_position
    )
    returning id into v_id;

    -- Ids only: the audit log never holds names or phones.
    insert into public.audit_log (actor_id, action, entity, entity_id, details)
    values (
      (select auth.uid()), 'client.create', 'client', v_id,
      jsonb_build_object('group_id', v_group_id, 'parent_id', v_parent_id)
    );
    v_ids := v_ids || v_id;
  end loop;

  return jsonb_build_object(
    'parent_id', v_parent_id,
    'child_ids', to_jsonb(v_ids),
    'created', true
  );
end;
$$;

revoke all on function public.create_children(uuid, jsonb, jsonb, uuid) from public, anon;
grant execute on function public.create_children(uuid, jsonb, jsonb, uuid)
  to authenticated, service_role;
