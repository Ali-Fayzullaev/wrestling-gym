-- Step 23, D-10 (2026-11-18, project owner): the "data processing" and "WhatsApp messages" consent
-- marks are gone from the client form and card, and the service no longer records them.
--
-- What stays: the consents table and the rows already on file. They are append-only (rule 4, the
-- forbid_change triggers): they show the consent was given back then. Staff may still read them
-- (consents_select), backups still carry them, and delete_client() still blanks rather than
-- removes a client that has them.
--
-- What goes: every way to add a row. create_client() and update_client() lose p_consents and the
-- "consents" key of their audit rows; add_client_consents() is dropped; the INSERT grant and the
-- insert policy are revoked, so not even a direct insert by a signed-in employee gets through.

-- Writes -----------------------------------------------------------------------------------------

drop function public.create_client(
  text, text, date, text, date, uuid, jsonb, uuid, text, text[], text
);
drop function public.update_client(
  uuid, text, text, date, text, date, uuid, jsonb, uuid, text, text[], text
);
drop function public.add_client_consents(uuid, text[]);

revoke insert on public.consents from public, anon, authenticated;
drop policy consents_insert on public.consents;

-- As in *_families.sql, without p_consents. A new argument list changes the signature, so the old
-- functions are dropped above rather than overloaded.
create function public.create_client(
  p_last_name text,
  p_first_name text,
  p_started_on date,
  p_phone text default null,
  p_birth_date date default null,
  p_parent_id uuid default null,
  p_new_parent jsonb default null,
  p_group_id uuid default null,
  p_note text default '',
  p_message_locale text default 'ru'
)
returns uuid
language plpgsql
set search_path = ''
as $$
declare
  v_id uuid;
  v_parent_id uuid;
begin
  perform public.require_staff_role(array['owner', 'admin']);
  perform public.check_client_group(p_group_id);
  v_parent_id := public.resolve_client_parent(p_parent_id, p_new_parent);

  -- An adult without a phone is stopped by clients_phone_or_parent (23514).
  insert into public.clients (
    last_name, first_name, birth_date, phone, parent_id, group_id, started_on, note,
    message_locale, created_by
  ) values (
    btrim(p_last_name),
    btrim(p_first_name),
    p_birth_date,
    p_phone,
    v_parent_id,
    p_group_id,
    p_started_on,
    coalesce(p_note, ''),
    coalesce(p_message_locale, 'ru'),
    (select auth.uid())
  )
  returning id into v_id;

  -- Ids only: the audit log never holds names or phones.
  insert into public.audit_log (actor_id, action, entity, entity_id, details)
  values (
    (select auth.uid()), 'client.create', 'client', v_id,
    jsonb_build_object('group_id', p_group_id, 'parent_id', v_parent_id)
  );
  return v_id;
end;
$$;

-- p_message_locale null keeps the language on file.
create function public.update_client(
  p_client_id uuid,
  p_last_name text,
  p_first_name text,
  p_started_on date,
  p_phone text default null,
  p_birth_date date default null,
  p_parent_id uuid default null,
  p_new_parent jsonb default null,
  p_group_id uuid default null,
  p_note text default '',
  p_message_locale text default null
)
returns void
language plpgsql
set search_path = ''
as $$
declare
  v_old public.clients;
  v_new public.clients;
  v_parent_id uuid;
  v_fields text[] := '{}';
begin
  perform public.require_staff_role(array['owner', 'admin']);
  select * into v_old from public.clients c where c.id = p_client_id for update;
  if not found or v_old.deleted_at is not null then
    raise exception 'client_not_found' using errcode = 'P0002';
  end if;
  perform public.check_client_group(p_group_id, v_old.group_id);
  -- A child may stay with a parent that was archived meanwhile, as with groups.
  if p_parent_id is not null and p_parent_id is not distinct from v_old.parent_id then
    v_parent_id := p_parent_id;
  else
    v_parent_id := public.resolve_client_parent(p_parent_id, p_new_parent);
  end if;

  update public.clients
  set last_name = btrim(p_last_name),
      first_name = btrim(p_first_name),
      birth_date = p_birth_date,
      phone = p_phone,
      parent_id = v_parent_id,
      group_id = p_group_id,
      started_on = p_started_on,
      note = coalesce(p_note, ''),
      message_locale = coalesce(p_message_locale, message_locale)
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
  if v_old.parent_id is distinct from v_new.parent_id then
    v_fields := array_append(v_fields, 'parent_id');
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
  if v_old.message_locale is distinct from v_new.message_locale then
    v_fields := array_append(v_fields, 'message_locale');
  end if;

  if cardinality(v_fields) > 0 then
    insert into public.audit_log (actor_id, action, entity, entity_id, details)
    values (
      (select auth.uid()), 'client.update', 'client', p_client_id,
      jsonb_build_object(
        'fields', to_jsonb(v_fields),
        'from_group_id', case when 'group_id' = any (v_fields) then v_old.group_id end,
        'to_group_id', case when 'group_id' = any (v_fields) then v_new.group_id end,
        'from_parent_id', case when 'parent_id' = any (v_fields) then v_old.parent_id end,
        'to_parent_id', case when 'parent_id' = any (v_fields) then v_new.parent_id end
      )
    );
  end if;
end;
$$;

-- Reads ------------------------------------------------------------------------------------------

-- The client card as in *_families.sql, without the consents on file.
create or replace function public.client_screen(
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
      'message_locale', c.message_locale,
      'group_id', c.group_id,
      'started_on', c.started_on,
      'note', c.note,
      'archived', c.archived_at is not null
    ),
    'parent', case when pa.id is null then null else jsonb_build_object(
      'id', pa.id,
      'name', pa.name,
      'phone', pa.phone,
      'message_locale', pa.message_locale,
      'archived', pa.archived_at is not null
    ) end,
    'group', case when g.id is null then null else jsonb_build_object(
      'id', g.id,
      'name', g.name,
      'coach_name', s.full_name,
      'archived', g.archived_at is not null,
      'price', g.default_price
    ) end,
    'subscription', jsonb_build_object(
      'status', cs.status,
      'period_start', cs.period_start,
      'ends_on', cs.ends_on,
      'days_left', cs.days_left
    ),
    'reminder', case when cs.payment_id is null then null else jsonb_build_object(
      'payment_id', cs.payment_id,
      'kind', case
        when cs.status = 'expired' then 'overdue'
        else coalesce(
          public.reminder_kind_for(
            cs.days_left, (select st.reminder_days from public.settings st limit 1)
          ),
          'before_7'
        )
      end
    ) end,
    'reminder_context', public.reminder_context(),
    'payments', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'id', p.id,
          'kind', p.kind,
          'amount', p.amount,
          'method', p.method,
          'period_start', p.period_start,
          'period_end', p.period_end,
          'reverses_id', p.reverses_id,
          'reason', p.reason,
          'created_at', p.created_at,
          'created_by', p.created_by,
          'created_by_name', ps.full_name
        )
        order by p.created_at desc, p.id
      )
      from public.payments p
      join public.staff ps on ps.id = p.created_by
      where p.client_id = c.id
    ), '[]'::jsonb),
    'reminders', coalesce((
      select jsonb_agg(
        public.reminder_event_json(e, ob.full_name, mb.full_name)
        order by e.opened_at desc, e.id
      )
      from public.reminder_events e
      join public.staff ob on ob.id = e.opened_by
      left join public.staff mb on mb.id = e.marked_sent_by
      where e.client_id = c.id
    ), '[]'::jsonb),
    'groups', coalesce((
      select jsonb_agg(jsonb_build_object('id', ag.id, 'name', ag.name) order by lower(ag.name), ag.id)
      from public.groups ag
      where ag.archived_at is null
    ), '[]'::jsonb)
  )
  from public.clients c
  join public.client_status(p_today) cs on cs.client_id = c.id
  left join public.parents pa on pa.id = c.parent_id
  left join public.groups g on g.id = c.group_id
  left join public.staff s on s.id = g.coach_id
  where c.id = p_client_id
    and c.deleted_at is null;
$$;

-- Grants -----------------------------------------------------------------------------------------

grant execute on function public.create_client(
  text, text, date, text, date, uuid, jsonb, uuid, text, text
) to authenticated, service_role;
grant execute on function public.update_client(
  uuid, text, text, date, text, date, uuid, jsonb, uuid, text, text
) to authenticated, service_role;
