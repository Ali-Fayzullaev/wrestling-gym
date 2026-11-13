-- Subscription status and the "Today" counters. These are the single source of truth: the app
-- never recomputes a status in JavaScript. Both run as the caller (security invoker), so RLS
-- applies and an inactive employee gets nothing.

-- The current subscription is the payment with the latest period_end that has not been reversed.
-- Thresholds: active > 7 days left, expiring 0..7, expired once ends_on has passed, none without
-- any effective payment.
create function public.client_status(
  p_today date default (now() at time zone 'Asia/Almaty')::date
)
returns table (
  client_id uuid,
  payment_id uuid,
  period_start date,
  ends_on date,
  days_left integer,
  status text
)
language sql
stable
set search_path = ''
as $$
  select
    c.id,
    cur.id,
    cur.period_start,
    cur.period_end,
    cur.period_end - p_today,
    case
      when cur.id is null then 'none'
      when cur.period_end < p_today then 'expired'
      when cur.period_end - p_today <= 7 then 'expiring'
      else 'active'
    end
  from public.clients c
  left join lateral (
    select p.id, p.period_start, p.period_end
    from public.payments p
    where p.client_id = c.id
      and p.kind = 'payment'
      and not exists (select 1 from public.payments r where r.reverses_id = p.id)
    order by p.period_end desc, p.created_at desc
    limit 1
  ) cur on true;
$$;

comment on function public.client_status(date) is
  'Current subscription per client on p_today (Asia/Almaty): active | expiring | expired | none.';

create view public.client_status_v
with (security_invoker = true)
as
select * from public.client_status();

comment on view public.client_status_v is 'client_status() for today in Asia/Almaty.';

-- Maps "days left" to the reminder kind due that day, or null when no reminder is due.
-- The larger configured day count is the early reminder (before_7), the smaller one the late
-- reminder (before_1); the last day of the subscription is "overdue".
create function public.reminder_kind_for(p_days_left integer, p_reminder_days integer[])
returns text
language sql
immutable
set search_path = ''
as $$
  select case
    when p_days_left = 0 then 'overdue'
    when not (p_days_left = any (p_reminder_days)) then null
    when cardinality(p_reminder_days) > 1
      and p_days_left = (select min(d) from unnest(p_reminder_days) d) then 'before_1'
    else 'before_7'
  end;
$$;

-- Four counters of the "Today" screen. Archived clients are not counted. These are head counts,
-- not money, so both roles may call it.
create function public.dashboard_counts(
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
  with settings as (
    select s.reminder_days from public.settings s limit 1
  ),
  current_clients as (
    select cs.*
    from public.client_status(p_today) cs
    join public.clients c on c.id = cs.client_id
    where c.archived_at is null
  ),
  due as (
    select cc.payment_id, public.reminder_kind_for(cc.days_left, st.reminder_days) as kind
    from current_clients cc
    cross join settings st
    where cc.payment_id is not null
  )
  select
    (
      select count(*)::integer
      from due d
      where d.kind is not null
        and not exists (
          select 1 from public.reminder_events re
          where re.payment_id = d.payment_id and re.kind = d.kind
        )
    ),
    (select count(*)::integer from current_clients where status = 'expired'),
    (select count(*)::integer from current_clients where status = 'expiring'),
    (
      select count(distinct p.client_id)::integer
      from public.payments p
      join public.clients c on c.id = p.client_id
      where p.kind = 'payment'
        and c.archived_at is null
        and (p.created_at at time zone 'Asia/Almaty')::date = p_today
        and not exists (select 1 from public.payments r where r.reverses_id = p.id)
    );
$$;

comment on function public.dashboard_counts(date) is
  'Counters for the Today screen on p_today (Asia/Almaty): remind, debtors, expiring, paid today.';
