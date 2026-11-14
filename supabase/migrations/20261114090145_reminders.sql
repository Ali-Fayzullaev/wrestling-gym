-- Reminders through wa.me links (step 09).
--
-- The app never sends anything. A wa.me link opens WhatsApp with a ready text; the database only
-- records what is known: the chat was opened (chat_opened), and later, if an employee says so, that
-- the message was sent (marked_sent).
-- Reads: each screen gets its data from one function call (plus the role check).
-- Writes: functions, so a change and its audit row commit together. Everything runs as the caller
-- (security invoker): RLS and grants still decide; explicit role checks only make a refusal clear.

-- One template per reminder kind: the kind picks the text, so two of a kind would be ambiguous.
-- The three templates are shipped by the migrations; the owner edits their texts only. Creating
-- another one or moving one to another kind is therefore not possible for anybody.
alter table public.message_templates
  add constraint message_templates_kind_unique unique (kind);

drop policy message_templates_insert on public.message_templates;
revoke insert on public.message_templates from authenticated;
revoke update (kind) on public.message_templates from authenticated;

-- What every screen with wa.me links needs besides the rows: the gym name, the configured days and
-- the templates. Nulls and an empty list for a caller RLS shows nothing to.
create function public.reminder_context()
returns jsonb
language sql
stable
set search_path = ''
as $$
  select jsonb_build_object(
    'gym_name', (select s.gym_name from public.settings s limit 1),
    'reminder_days', (select to_jsonb(s.reminder_days) from public.settings s limit 1),
    'templates', coalesce((
      select jsonb_agg(
        jsonb_build_object('id', t.id, 'kind', t.kind, 'body', t.body) order by t.kind
      )
      from public.message_templates t
    ), '[]'::jsonb)
  );
$$;

comment on function public.reminder_context() is
  'Gym name, reminder days and templates: what a wa.me reminder text is built from.';

-- The fields of one client a reminder text and link are built from. The phone goes into the wa.me
-- link only; screens never print it next to the button.
create function public.reminder_contact_json(
  p_client public.clients,
  p_group_name text,
  p_price integer,
  p_payment_id uuid,
  p_kind text,
  p_ends_on date
)
returns jsonb
language sql
immutable
set search_path = ''
as $$
  select jsonb_build_object(
    'id', p_client.id,
    'last_name', p_client.last_name,
    'first_name', p_client.first_name,
    'phone', p_client.phone,
    'phone_owner', p_client.phone_owner,
    'parent_name', p_client.parent_name,
    'group_name', p_group_name,
    'price', p_price,
    'payment_id', p_payment_id,
    'kind', p_kind,
    'ends_on', p_ends_on
  );
$$;

-- One reminder event with the names of who opened the chat and who marked it sent.
create function public.reminder_event_json(
  p_event public.reminder_events,
  p_opened_by_name text,
  p_marked_by_name text
)
returns jsonb
language sql
immutable
set search_path = ''
as $$
  select jsonb_build_object(
    'id', p_event.id,
    'client_id', p_event.client_id,
    'payment_id', p_event.payment_id,
    'kind', p_event.kind,
    'status', p_event.status,
    'opened_at', p_event.opened_at,
    'opened_by_name', p_opened_by_name,
    'marked_sent_at', p_event.marked_sent_at,
    'marked_sent_by_name', p_marked_by_name
  );
$$;

-- Writes -----------------------------------------------------------------------------------------

-- Records that the wa.me chat of this kind was opened for this subscription. A repeated click, a
-- network retry or a parallel tab hits reminder_events (payment_id, kind) and gets the first event
-- back with created = false. The template is the one of that kind.
create function public.record_reminder_opened(p_payment_id uuid, p_kind text)
returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  v_client_id uuid;
  v_template_id uuid;
  v_event public.reminder_events;
  v_created boolean := true;
begin
  perform public.require_staff_role(array['owner', 'admin']);
  if p_kind is null or p_kind not in ('before_7', 'before_1', 'overdue') then
    raise exception 'invalid_kind' using errcode = '22023';
  end if;

  select p.client_id into v_client_id
  from public.payments p
  where p.id = p_payment_id and p.kind = 'payment';
  if not found then
    raise exception 'payment_not_found' using errcode = 'P0002';
  end if;

  select t.id into v_template_id from public.message_templates t where t.kind = p_kind;
  if not found then
    raise exception 'template_not_found' using errcode = 'P0002';
  end if;

  insert into public.reminder_events (client_id, payment_id, kind, template_id, opened_by)
  values (v_client_id, p_payment_id, p_kind, v_template_id, (select auth.uid()))
  on conflict (payment_id, kind) do nothing
  returning * into v_event;

  if not found then
    v_created := false;
    select * into v_event
    from public.reminder_events re
    where re.payment_id = p_payment_id and re.kind = p_kind;
  end if;

  return jsonb_build_object(
    'id', v_event.id,
    'client_id', v_event.client_id,
    'opened_at', v_event.opened_at,
    'status', v_event.status,
    'created', v_created
  );
end;
$$;

-- The manual "marked as sent". Only chat_opened -> marked_sent exists (the update trigger enforces
-- it); a second mark, also a parallel one, changes nothing and reports changed = false.
create function public.mark_reminder_sent(p_event_id uuid)
returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  v_event public.reminder_events;
  v_changed boolean := true;
begin
  perform public.require_staff_role(array['owner', 'admin']);

  update public.reminder_events
  set status = 'marked_sent', marked_sent_by = (select auth.uid())
  where id = p_event_id and status = 'chat_opened'
  returning * into v_event;

  if not found then
    v_changed := false;
    select * into v_event from public.reminder_events re where re.id = p_event_id;
    if not found then
      raise exception 'reminder_not_found' using errcode = 'P0002';
    end if;
  end if;

  return jsonb_build_object(
    'id', v_event.id,
    'status', v_event.status,
    'marked_sent_at', v_event.marked_sent_at,
    'changed', v_changed
  );
end;
$$;

-- The owner's reminder settings: the days and the template texts, saved together. Only what
-- actually changed is written, each change with its audit row (field names and ids, no texts).
-- p_templates: [{"id": uuid, "body": text}, ...].
create function public.update_reminder_settings(p_reminder_days integer[], p_templates jsonb)
returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  v_old_days integer[];
  v_days_changed boolean := false;
  v_templates_changed integer := 0;
  v_item jsonb;
  v_template public.message_templates;
  v_body text;
begin
  perform public.require_staff_role(array['owner']);
  if p_reminder_days is null or jsonb_typeof(p_templates) is distinct from 'array' then
    raise exception 'invalid_settings' using errcode = '22023';
  end if;

  select s.reminder_days into v_old_days from public.settings s where s.id for update;
  if v_old_days is distinct from p_reminder_days then
    -- settings.reminder_days has the range and distinctness checks (23514 on a bad value).
    update public.settings set reminder_days = p_reminder_days where id;
    insert into public.audit_log (actor_id, action, entity, entity_id, details)
    values (
      (select auth.uid()), 'settings.update', 'settings', null,
      jsonb_build_object(
        'fields', jsonb_build_array('reminder_days'),
        'from', to_jsonb(v_old_days),
        'to', to_jsonb(p_reminder_days)
      )
    );
    v_days_changed := true;
  end if;

  for v_item in select value from jsonb_array_elements(p_templates) loop
    if jsonb_typeof(v_item -> 'body') is distinct from 'string' then
      raise exception 'invalid_settings' using errcode = '22023';
    end if;
    v_body := v_item ->> 'body';
    select * into v_template
    from public.message_templates t
    where t.id = (v_item ->> 'id')::uuid
    for update;
    if not found then
      raise exception 'template_not_found' using errcode = 'P0002';
    end if;
    if v_template.body is distinct from v_body then
      update public.message_templates
      set body = v_body, updated_by = (select auth.uid())
      where id = v_template.id;
      insert into public.audit_log (actor_id, action, entity, entity_id, details)
      values (
        (select auth.uid()), 'template.update', 'message_template', v_template.id,
        jsonb_build_object('fields', jsonb_build_array('body'), 'kind', v_template.kind)
      );
      v_templates_changed := v_templates_changed + 1;
    end if;
  end loop;

  return jsonb_build_object(
    'days_changed', v_days_changed,
    'templates_changed', v_templates_changed
  );
end;
$$;

-- Reads ------------------------------------------------------------------------------------------

-- The /reminders screen, one tab per call:
--   today   - reminders due on p_today and not opened yet (the same reminders_due() as the Today
--             screen), and the chats opened today with their marks;
--   overdue - current clients whose subscription has ended, with the event of their "overdue"
--             reminder if there is one;
--   history - events opened on p_date (default p_today), optionally by or marked by p_staff_id,
--             newest first, and the staff list for the filter.
-- Deleted (blanked) clients are left out: there is nobody to remind and no name to show.
create function public.reminders_screen(
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
          public.reminder_contact_json(c, g.name, g.default_price, r.payment_id, r.kind, r.ends_on)
          order by r.ends_on, lower(c.last_name), lower(c.first_name), c.id
        )
        from public.reminders_due(p_today) r
        join public.clients c on c.id = r.client_id
        left join public.groups g on g.id = c.group_id and g.archived_at is null
      ), '[]'::jsonb),
      'opened', coalesce((
        select jsonb_agg(
          public.reminder_event_json(e, ob.full_name, mb.full_name)
            || jsonb_build_object('last_name', c.last_name, 'first_name', c.first_name)
          order by e.opened_at desc, e.id
        )
        from public.reminder_events e
        join public.clients c on c.id = e.client_id and c.deleted_at is null
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
              c, g.name, g.default_price, cs.payment_id, 'overdue', cs.ends_on
            ) || jsonb_build_object(
              'event',
              case when e.id is null then null
                   else public.reminder_event_json(e, ob.full_name, mb.full_name) end
            ) as row_json
          from public.client_status(p_today) cs
          join public.clients c on c.id = cs.client_id
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

-- The owner's "Settings -> Reminders" screen: days, templates, and a real client to preview the
-- texts on (the first current client with a subscription and a group, by name).
create function public.reminder_settings_screen(
  p_today date default (now() at time zone 'Asia/Almaty')::date
)
returns jsonb
language sql
stable
set search_path = ''
as $$
  select jsonb_build_object(
    'context', public.reminder_context(),
    'preview', (
      select public.reminder_contact_json(c, g.name, g.default_price, cs.payment_id, null, cs.ends_on)
      from public.clients c
      join public.client_status(p_today) cs on cs.client_id = c.id
      join public.groups g on g.id = c.group_id and g.archived_at is null
      where c.archived_at is null and cs.payment_id is not null
      order by lower(c.last_name), lower(c.first_name), c.id
      limit 1
    )
  );
$$;

-- The Today screen as in step 08; rows to remind now also carry what their wa.me link is built
-- from (the subscription, the reminder kind, the phone and who it belongs to), and the screen
-- carries the reminder context. Counters and lists still come from reminders_due() and paid_today().
create or replace function public.today_screen(
  p_today date default (now() at time zone 'Asia/Almaty')::date
)
returns jsonb
language sql
stable
set search_path = ''
as $$
  with due as (
    select r.client_id, r.payment_id, r.kind from public.reminders_due(p_today) r
  ),
  paid as (
    select p.client_id from public.paid_today(p_today) p
  ),
  listed as (
    select
      c.id,
      c.last_name,
      c.first_name,
      c.phone,
      c.phone_owner,
      c.parent_name,
      g.name as group_name,
      g.default_price as price,
      cs.ends_on,
      d.payment_id as remind_payment_id,
      d.kind as remind_kind,
      d.client_id is not null as remind,
      c.id in (select client_id from paid) as paid
    from public.clients c
    join public.client_status(p_today) cs on cs.client_id = c.id
    left join public.groups g on g.id = c.group_id and g.archived_at is null
    left join due d on d.client_id = c.id
    where c.id in (select client_id from due union select client_id from paid)
  ),
  rows as (
    select
      l.*,
      jsonb_build_object(
        'id', l.id,
        'last_name', l.last_name,
        'first_name', l.first_name,
        'group_name', l.group_name,
        'price', l.price,
        'ends_on', l.ends_on
      ) as row_json
    from listed l
  )
  select jsonb_build_object(
    'counts', (select to_jsonb(dc) from public.dashboard_counts(p_today) dc),
    -- Soonest end first (ends today at the top), then by name.
    'remind', coalesce((
      select jsonb_agg(
        r.row_json || jsonb_build_object(
          'reminder', jsonb_build_object(
            'payment_id', r.remind_payment_id,
            'kind', r.remind_kind,
            'phone', r.phone,
            'phone_owner', r.phone_owner,
            'parent_name', r.parent_name
          )
        )
        order by r.ends_on, lower(r.last_name), lower(r.first_name), r.id
      )
      from rows r
      where r.remind
    ), '[]'::jsonb),
    'paid', coalesce((
      select jsonb_agg(r.row_json order by lower(r.last_name), lower(r.first_name), r.id)
      from rows r
      where r.paid
    ), '[]'::jsonb),
    'reminder_context', public.reminder_context()
  );
$$;

-- The client card as in step 07, plus the reminder history (newest first) so it stays one call.
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
      'archived', g.archived_at is not null,
      'price', g.default_price
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
  left join public.groups g on g.id = c.group_id
  left join public.staff s on s.id = g.coach_id
  where c.id = p_client_id
    and c.deleted_at is null;
$$;

-- Foreign keys of reminder_events and message_templates used by the joins above and by the advisors.
create index reminder_events_opened_by_idx on public.reminder_events (opened_by);
create index reminder_events_marked_sent_by_idx on public.reminder_events (marked_sent_by);
create index reminder_events_template_id_idx on public.reminder_events (template_id);
create index message_templates_updated_by_idx on public.message_templates (updated_by);

grant execute on function public.reminder_context() to authenticated, service_role;
grant execute on function public.reminder_contact_json(public.clients, text, integer, uuid, text, date)
  to authenticated, service_role;
grant execute on function public.reminder_event_json(public.reminder_events, text, text)
  to authenticated, service_role;
grant execute on function public.record_reminder_opened(uuid, text) to authenticated, service_role;
grant execute on function public.mark_reminder_sent(uuid) to authenticated, service_role;
grant execute on function public.update_reminder_settings(integer[], jsonb)
  to authenticated, service_role;
grant execute on function public.reminders_screen(text, date, date, uuid, integer)
  to authenticated, service_role;
grant execute on function public.reminder_settings_screen(date) to authenticated, service_role;
