-- Step 22: the family block on the Reminders screen, a parent's archive and deletion.
--
-- Reminders: a parent with several children to remind gets one block on the Reminders tabs as on
-- Today (D-18). "Chat opened" for the block is record_family_reminder_opened() from step 21; here
-- the block also gets "marked as sent" for all its children at once, and the chats opened today
-- carry the child's parent so the screen can put them together.
--
-- Parents: archive and restore (owner and admin) and deletion (owner only, a parent without
-- children), each with an audit row holding ids and the reason only, never a name or a phone.
-- Not decided by the customer and left as they were: D-20 (a child is reminded through the parent
-- only), D-21 (one parent per child), D-22 (the family texts are drafts).

-- Audit ------------------------------------------------------------------------------------------

-- As in *_families.sql plus the parent's archive, restore and deletion; src/features/audit/actions.ts
-- keeps the same list.
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
      'parent.create',
      'parent.update',
      'parent.archive',
      'parent.restore',
      'parent.delete',
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

-- Reminders --------------------------------------------------------------------------------------

-- "Marked as sent" for one message to a parent: every child in p_items at once, in this one
-- transaction, or none. p_items: [{"payment_id", "kind"}], 1..20, each a current child of
-- p_parent_id whose chat of that kind was opened. A child without "chat opened" refuses the whole
-- call (a mark needs an opened chat, as mark_reminder_sent() does). Children already marked are
-- left as they were, so a repeat changes nothing.
create function public.mark_family_reminders_sent(p_parent_id uuid, p_items jsonb)
returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  v_item record;
  v_event public.reminder_events;
  v_changed boolean;
  v_results jsonb := '[]'::jsonb;
begin
  perform public.require_staff_role(array['owner', 'admin']);
  if p_items is null or jsonb_typeof(p_items) <> 'array'
     or jsonb_array_length(p_items) not between 1 and 20 then
    raise exception 'invalid_items' using errcode = '22023';
  end if;
  if (select count(distinct (i ->> 'payment_id', i ->> 'kind')) from jsonb_array_elements(p_items) i)
     <> jsonb_array_length(p_items) then
    raise exception 'invalid_items' using errcode = '22023';
  end if;
  if not exists (select 1 from public.parents p where p.id = p_parent_id) then
    raise exception 'parent_not_found' using errcode = 'P0002';
  end if;

  for v_item in
    select * from jsonb_to_recordset(p_items) as i (payment_id uuid, kind text)
  loop
    if v_item.kind is null or v_item.kind not in ('before_7', 'before_1', 'overdue') then
      raise exception 'invalid_kind' using errcode = '22023';
    end if;

    -- Locked, so two "Sent" clicks at once mark each event once.
    select re.* into v_event
    from public.reminder_events re
    join public.clients c on c.id = re.client_id
    where re.payment_id = v_item.payment_id
      and re.kind = v_item.kind
      and c.parent_id = p_parent_id
      and c.deleted_at is null
    for update of re;
    if not found then
      raise exception 'reminder_not_found' using errcode = 'P0002';
    end if;

    v_changed := v_event.status = 'chat_opened';
    if v_changed then
      update public.reminder_events
      set status = 'marked_sent', marked_sent_by = (select auth.uid())
      where id = v_event.id
      returning * into v_event;
    end if;

    v_results := v_results || jsonb_build_object(
      'id', v_event.id,
      'client_id', v_event.client_id,
      'status', v_event.status,
      'marked_sent_at', v_event.marked_sent_at,
      'changed', v_changed
    );
  end loop;

  return v_results;
end;
$$;

comment on function public.mark_family_reminders_sent(uuid, jsonb) is
  'Marks the opened chats of a parent''s children as sent, all in one transaction or none.';

-- As in *_families.sql; a chat opened today also names the child's parent, so the "Opened today"
-- list can put one parent's children together.
create or replace function public.reminders_screen(
  p_tab text,
  p_today date default (now() at time zone 'Asia/Almaty')::date,
  p_date date default null,
  p_staff_id uuid default null,
  p_limit integer default 300
)
returns jsonb
language plpgsql
stable
set search_path = ''
as $$
declare
  v_limit integer := greatest(least(coalesce(p_limit, 300), 1000), 0);
  v_day date := coalesce(p_date, p_today);
begin
  if p_tab = 'today' then
    return jsonb_build_object(
      'context', public.reminder_context(),
      'due', coalesce((
        select jsonb_agg(
          public.reminder_contact_json(c, pa, g.name, g.default_price, r.payment_id, r.kind, r.ends_on)
          order by r.ends_on, lower(c.last_name), lower(c.first_name), c.id
        )
        from public.reminders_due(p_today) r
        join public.clients c on c.id = r.client_id
        left join public.parents pa on pa.id = c.parent_id
        left join public.groups g on g.id = c.group_id and g.archived_at is null
      ), '[]'::jsonb),
      'opened', coalesce((
        select jsonb_agg(
          public.reminder_event_json(e, ob.full_name, mb.full_name)
            || jsonb_build_object(
              'last_name', c.last_name,
              'first_name', c.first_name,
              'parent_id', pa.id,
              'parent_name', pa.name
            )
          order by e.opened_at desc, e.id
        )
        from public.reminder_events e
        join public.clients c on c.id = e.client_id and c.deleted_at is null
        left join public.parents pa on pa.id = c.parent_id
        join public.staff ob on ob.id = e.opened_by
        left join public.staff mb on mb.id = e.marked_sent_by
        where e.opened_at >= (p_today::timestamp at time zone 'Asia/Almaty')
          and e.opened_at < ((p_today + 1)::timestamp at time zone 'Asia/Almaty')
      ), '[]'::jsonb)
    );
  elsif p_tab = 'overdue' then
    return jsonb_build_object(
      'context', public.reminder_context(),
      'overdue', coalesce((
        select jsonb_agg(o.row_json order by o.ends_on desc, o.sort_last, o.sort_first, o.id)
        from (
          select
            c.id,
            cs.ends_on,
            lower(c.last_name) as sort_last,
            lower(c.first_name) as sort_first,
            public.reminder_contact_json(
              c, pa, g.name, g.default_price, cs.payment_id, 'overdue', cs.ends_on
            ) || jsonb_build_object(
              'event',
              case when e.id is null then null
                   else public.reminder_event_json(e, ob.full_name, mb.full_name) end
            ) as row_json
          from public.client_status(p_today) cs
          join public.clients c on c.id = cs.client_id
          left join public.parents pa on pa.id = c.parent_id
          left join public.groups g on g.id = c.group_id and g.archived_at is null
          left join public.reminder_events e
            on e.payment_id = cs.payment_id and e.kind = 'overdue'
          left join public.staff ob on ob.id = e.opened_by
          left join public.staff mb on mb.id = e.marked_sent_by
          where cs.status = 'expired' and c.archived_at is null
          order by cs.ends_on desc, lower(c.last_name), lower(c.first_name), c.id
          limit v_limit
        ) o
      ), '[]'::jsonb)
    );
  elsif p_tab = 'history' then
    return jsonb_build_object(
      'events', coalesce((
        select jsonb_agg(h.row_json order by h.opened_at desc, h.id)
        from (
          select
            e.id,
            e.opened_at,
            public.reminder_event_json(e, ob.full_name, mb.full_name)
              || jsonb_build_object('last_name', c.last_name, 'first_name', c.first_name)
              as row_json
          from public.reminder_events e
          join public.clients c on c.id = e.client_id and c.deleted_at is null
          join public.staff ob on ob.id = e.opened_by
          left join public.staff mb on mb.id = e.marked_sent_by
          where e.opened_at >= (v_day::timestamp at time zone 'Asia/Almaty')
            and e.opened_at < ((v_day + 1)::timestamp at time zone 'Asia/Almaty')
            and (p_staff_id is null or e.opened_by = p_staff_id or e.marked_sent_by = p_staff_id)
          order by e.opened_at desc, e.id
          limit v_limit
        ) h
      ), '[]'::jsonb),
      'staff', coalesce((
        select jsonb_agg(jsonb_build_object('id', s.id, 'name', s.full_name) order by s.full_name, s.id)
        from public.staff s
      ), '[]'::jsonb)
    );
  end if;
  raise exception 'invalid_tab' using errcode = '22023';
end;
$$;

comment on function public.reminders_screen(text, date, date, uuid, integer) is
  'One tab of the Reminders screen on p_today (Asia/Almaty): today | overdue | history.';

-- Parents ----------------------------------------------------------------------------------------

-- Archive or bring back a parent; a repeat changes nothing and returns false. Owner and admin, as
-- set_client_archived().
-- STUB(D-23): a parent with a child not in the archive cannot be archived: the child would stay in
-- work with an archived parent, and who gets their reminders then is not decided. Waits for the
-- customer's confirmation (docs/spec/90-open-decisions.md).
create function public.set_parent_archived(p_parent_id uuid, p_archived boolean)
returns boolean
language plpgsql
set search_path = ''
as $$
declare
  v_parent public.parents;
begin
  perform public.require_staff_role(array['owner', 'admin']);
  if p_archived is null then
    raise exception 'invalid_archived' using errcode = '22023';
  end if;
  -- Locked: a child cannot be linked to this parent while it is being archived (the
  -- clients_parent_not_archived trigger waits for this lock).
  select * into v_parent from public.parents p where p.id = p_parent_id for update;
  if not found then
    raise exception 'parent_not_found' using errcode = 'P0002';
  end if;
  if (v_parent.archived_at is not null) = p_archived then
    return false;
  end if;
  if p_archived and exists (
    select 1 from public.clients c
    where c.parent_id = p_parent_id and c.archived_at is null and c.deleted_at is null
  ) then
    raise exception 'parent_has_active_children' using errcode = '23514';
  end if;

  update public.parents
  set archived_at = case when p_archived then now() end
  where id = p_parent_id;
  insert into public.audit_log (actor_id, action, entity, entity_id)
  values (
    (select auth.uid()),
    case when p_archived then 'parent.archive' else 'parent.restore' end,
    'parent',
    p_parent_id
  );
  return true;
end;
$$;

comment on function public.set_parent_archived(uuid, boolean) is
  'Archives or restores a parent (owner, admin); refuses one with children in work (D-23).';

-- STUB(D-23), the other side: no path may put a child in work with an archived parent. A new
-- child, a move to another parent and a child brought back from the archive all pass here, also
-- from the import, so the rule holds in one place instead of in every function that writes
-- clients. FOR SHARE on the parent row orders this against set_parent_archived(), which holds
-- FOR UPDATE: whichever comes second waits and then sees the other's result, so a child saved
-- while its parent is being archived is refused, and archiving while a child is being saved is
-- refused by parent_has_active_children. An unknown parent is left to the foreign key.
-- SECURITY DEFINER: a row lock needs the UPDATE right on parents, which the import's caller and
-- RLS do not always give; the function only reads one row by id.
create function public.check_client_parent_not_archived()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_archived boolean;
begin
  if new.parent_id is null or new.archived_at is not null or new.deleted_at is not null then
    return new;
  end if;
  -- A child already in work with this parent: an edit of other fields changes nothing here.
  if tg_op = 'UPDATE' and new.parent_id = old.parent_id
     and old.archived_at is null and old.deleted_at is null then
    return new;
  end if;
  select p.archived_at is not null into v_archived
  from public.parents p
  where p.id = new.parent_id
  for share;
  if found and v_archived then
    raise exception 'parent_archived' using errcode = '23514';
  end if;
  return new;
end;
$$;

comment on function public.check_client_parent_not_archived() is
  'Trigger: refuses a child in work with an archived parent (STUB(D-23)).';

revoke all on function public.check_client_parent_not_archived() from public, anon, authenticated;

create trigger clients_parent_not_archived
  before insert or update of parent_id, archived_at, deleted_at on public.clients
  for each row execute function public.check_client_parent_not_archived();

-- Deletes a parent created by mistake: owner only, after typing the parent's name and choosing a
-- reason from the fixed list (free text could carry personal data into the audit log). Only a
-- parent without children, archived ones included; a deleted client is already unlinked. The
-- foreign key (on delete restrict) stays the last guard. SECURITY INVOKER: the parents_delete
-- policy lets only the owner delete, and the role check below says so first.
create function public.delete_parent(p_parent_id uuid, p_reason text, p_name text)
returns void
language plpgsql
set search_path = ''
as $$
declare
  v_parent public.parents;
begin
  perform public.require_staff_role(array['owner']);
  if p_reason is null
     or p_reason not in ('duplicate', 'created_by_mistake', 'client_request', 'other') then
    raise exception 'invalid_reason' using errcode = '22023';
  end if;

  select * into v_parent from public.parents p where p.id = p_parent_id for update;
  if not found then
    raise exception 'parent_not_found' using errcode = 'P0002';
  end if;
  if lower(btrim(coalesce(p_name, ''))) <> lower(btrim(v_parent.name)) then
    raise exception 'confirmation_mismatch' using errcode = '22023';
  end if;
  if exists (select 1 from public.clients c where c.parent_id = p_parent_id) then
    raise exception 'parent_has_children' using errcode = '23503';
  end if;

  delete from public.parents where id = p_parent_id;
  insert into public.audit_log (actor_id, action, entity, entity_id, details)
  values (
    (select auth.uid()), 'parent.delete', 'parent', p_parent_id,
    jsonb_build_object('reason', p_reason)
  );
end;
$$;

comment on function public.delete_parent(uuid, text, text) is
  'Deletes a parent without children (owner only), with the reason in the audit log.';

-- Grants -----------------------------------------------------------------------------------------

grant execute on function public.mark_family_reminders_sent(uuid, jsonb)
  to authenticated, service_role;
grant execute on function public.set_parent_archived(uuid, boolean) to authenticated, service_role;
grant execute on function public.delete_parent(uuid, text, text) to authenticated, service_role;
