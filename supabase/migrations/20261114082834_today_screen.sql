-- The "Today" screen (step 08).
--
-- The counters and the lists under them come from the same two row sources, reminders_due() and
-- paid_today(), so a counter and the list it opens can never disagree. dashboard_counts() keeps its
-- signature and results; it now counts those sources instead of repeating their conditions.
-- today_screen() returns the whole screen in one call: the role check plus this is two requests.
-- Everything runs as the caller (security invoker), so RLS and grants still decide.

-- Current (not archived) clients with a reminder due on p_today that has not been opened yet for
-- their current subscription: days left is one of settings.reminder_days, or the subscription ends
-- today. Deleted clients are always archived (clients_deleted_is_archived).
create function public.reminders_due(
  p_today date default (now() at time zone 'Asia/Almaty')::date
)
returns table (
  client_id uuid,
  payment_id uuid,
  kind text,
  ends_on date
)
language sql
stable
set search_path = ''
as $$
  with settings as (
    select s.reminder_days from public.settings s limit 1
  ),
  due as (
    select
      cs.client_id,
      cs.payment_id,
      public.reminder_kind_for(cs.days_left, st.reminder_days) as kind,
      cs.ends_on
    from public.client_status(p_today) cs
    join public.clients c on c.id = cs.client_id
    cross join settings st
    where c.archived_at is null
      and cs.payment_id is not null
  )
  select d.client_id, d.payment_id, d.kind, d.ends_on
  from due d
  where d.kind is not null
    and not exists (
      select 1 from public.reminder_events re
      where re.payment_id = d.payment_id and re.kind = d.kind
    );
$$;

comment on function public.reminders_due(date) is
  'Clients to remind on p_today (Asia/Almaty) whose reminder of that kind is not opened yet.';

-- Current clients with a payment recorded on p_today in Asia/Almaty that has not been reversed
-- (a payment cancelled right away is reversed too). One row per client.
create function public.paid_today(
  p_today date default (now() at time zone 'Asia/Almaty')::date
)
returns table (client_id uuid)
language sql
stable
set search_path = ''
as $$
  select distinct p.client_id
  from public.payments p
  join public.clients c on c.id = p.client_id
  where p.kind = 'payment'
    and c.archived_at is null
    and (p.created_at at time zone 'Asia/Almaty')::date = p_today
    and not exists (select 1 from public.payments r where r.reverses_id = p.id);
$$;

comment on function public.paid_today(date) is
  'Current clients with a non-reversed payment recorded on p_today (Asia/Almaty).';

create or replace function public.dashboard_counts(
  p_today date default (now() at time zone 'Asia/Almaty')::date
)
returns table (
  remind_today integer,
  debtors integer,
  expiring_week integer,
  paid_today integer
)
language sql
stable
set search_path = ''
as $$
  with current_clients as (
    select cs.status
    from public.client_status(p_today) cs
    join public.clients c on c.id = cs.client_id
    where c.archived_at is null
  )
  select
    (select count(*)::integer from public.reminders_due(p_today)),
    (select count(*)::integer from current_clients where status = 'expired'),
    (select count(*)::integer from current_clients where status = 'expiring'),
    (select count(*)::integer from public.paid_today(p_today));
$$;

-- The /today screen: the four counters and both lists (who to remind, who paid today). Each row
-- has the name, the active group (name, and price for the payment form) and the end of the current
-- subscription. client_status() runs once for all rows, not once per row.
create function public.today_screen(
  p_today date default (now() at time zone 'Asia/Almaty')::date
)
returns jsonb
language sql
stable
set search_path = ''
as $$
  with due as (
    select r.client_id from public.reminders_due(p_today) r
  ),
  paid as (
    select p.client_id from public.paid_today(p_today) p
  ),
  listed as (
    select
      c.id,
      c.last_name,
      c.first_name,
      g.name as group_name,
      g.default_price as price,
      cs.ends_on,
      c.id in (select client_id from due) as remind,
      c.id in (select client_id from paid) as paid
    from public.clients c
    join public.client_status(p_today) cs on cs.client_id = c.id
    left join public.groups g on g.id = c.group_id and g.archived_at is null
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
        r.row_json order by r.ends_on, lower(r.last_name), lower(r.first_name), r.id
      )
      from rows r
      where r.remind
    ), '[]'::jsonb),
    'paid', coalesce((
      select jsonb_agg(r.row_json order by lower(r.last_name), lower(r.first_name), r.id)
      from rows r
      where r.paid
    ), '[]'::jsonb)
  );
$$;

comment on function public.today_screen(date) is
  'Everything the Today screen shows on p_today (Asia/Almaty): counters and both lists.';

grant execute on function public.reminders_due(date) to authenticated, service_role;
grant execute on function public.paid_today(date) to authenticated, service_role;
grant execute on function public.today_screen(date) to authenticated, service_role;
