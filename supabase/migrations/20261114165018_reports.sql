-- Owner reports and exports (step 11).
--
-- Money for a month is counted here, never in JS. Rules:
--   * the month of a payment is the Asia/Almaty calendar month of the moment it was recorded
--     (created_at), so a payment on the 30th at 23:30 in Almaty belongs to that month;
--   * a reversed payment (corrected later or cancelled right away) brings no money: it leaves the
--     total of the month it was recorded in, and is shown separately as "reversed". This keeps
--     the total of a month equal to the money that really came in that month;
--   * an opening balance from the import (kind import_balance, amount 0, no method) is not money
--     and is never counted as a payment;
--   * a payment counts for the client's current group: payments do not store the group.
-- Every function checks the owner role itself (STUB(D-09): reports and exports are owner only);
-- they run as the caller (security invoker), so RLS and grants still apply.

-- Months are cut by created_at ranges, so this index serves the report and the export.
create index payments_created_at_idx on public.payments (created_at);

-- First instant of p_month (a first day of a month) and of the month after it, in Asia/Almaty.
create function public.report_month_bounds(p_month date)
returns table (starts_at timestamptz, ends_at timestamptz)
language plpgsql
immutable
set search_path = ''
as $$
begin
  if p_month is null or p_month <> date_trunc('month', p_month)::date
     or p_month not between date '2020-01-01' and date '2100-12-01' then
    raise exception 'invalid_month' using errcode = '22023';
  end if;
  return query select
    p_month::timestamp at time zone 'Asia/Almaty',
    (p_month + interval '1 month')::timestamp at time zone 'Asia/Almaty';
end;
$$;

-- The /reports screen in one call: totals of p_month, split by payment method and by group, and
-- the debtors on p_today grouped by their active group with the expected amount at the group's
-- price (STUB(D-02): one monthly price per group).
create function public.report_month(
  p_month date,
  p_today date default (now() at time zone 'Asia/Almaty')::date
)
returns jsonb
language plpgsql
stable
set search_path = ''
as $$
begin
  perform public.require_staff_role(array['owner']);
  perform public.report_month_bounds(p_month);

  return (
    -- Payments (not reversals, not opening balances) recorded in p_month.
    with paid as (
      select
        p.id as payment_id,
        p.amount,
        p.method,
        c.group_id,
        exists (select 1 from public.payments r where r.reverses_id = p.id) as reversed
      from public.payments p
      join public.clients c on c.id = p.client_id
      cross join public.report_month_bounds(p_month) b
      where p.kind = 'payment'
        and p.created_at >= b.starts_at
        and p.created_at < b.ends_at
    ),
    counted as (
      select * from paid where not reversed
    ),
    by_method as (
      select
        m.method,
        coalesce(sum(c.amount), 0)::bigint as amount,
        count(c.payment_id)::integer as count
      from unnest(array['cash', 'kaspi', 'transfer']) with ordinality as m (method, position)
      left join counted c on c.method = m.method
      group by m.method, m.position
      order by m.position
    ),
    by_group as (
      select
        c.group_id,
        g.name,
        sum(c.amount)::bigint as amount,
        count(*)::integer as count
      from counted c
      left join public.groups g on g.id = c.group_id
      group by c.group_id, g.name
    ),
    debtors as (
      select
        cl.id,
        cl.last_name,
        cl.first_name,
        cs.ends_on,
        g.id as group_id,
        g.name as group_name,
        g.default_price as price
      from public.client_status(p_today) cs
      join public.clients cl on cl.id = cs.client_id
      left join public.groups g on g.id = cl.group_id and g.archived_at is null
      where cl.archived_at is null
        and cs.status = 'expired'
    ),
    debtor_groups as (
      select
        d.group_id,
        d.group_name,
        d.price,
        count(*)::integer as count,
        jsonb_agg(
          jsonb_build_object(
            'id', d.id,
            'last_name', d.last_name,
            'first_name', d.first_name,
            'ends_on', d.ends_on
          )
          order by lower(d.last_name), lower(d.first_name), d.id
        ) as clients
      from debtors d
      group by d.group_id, d.group_name, d.price
    )
    select jsonb_build_object(
      'total', jsonb_build_object(
        'amount', (select coalesce(sum(amount), 0)::bigint from counted),
        'count', (select count(*)::integer from counted)
      ),
      'reversed', jsonb_build_object(
        'amount', (select coalesce(sum(amount), 0)::bigint from paid where reversed),
        'count', (select count(*)::integer from paid where reversed)
      ),
      'by_method', (
        select jsonb_agg(
          jsonb_build_object('method', m.method, 'amount', m.amount, 'count', m.count)
        )
        from by_method m
      ),
      -- Biggest first; payments of clients without a group come last.
      'by_group', coalesce((
        select jsonb_agg(
          jsonb_build_object(
            'group_id', g.group_id, 'name', g.name, 'amount', g.amount, 'count', g.count
          )
          order by g.group_id is null, g.amount desc, lower(g.name), g.group_id
        )
        from by_group g
      ), '[]'::jsonb),
      'debtors', coalesce((
        select jsonb_agg(
          jsonb_build_object(
            'group_id', d.group_id,
            'name', d.group_name,
            'price', d.price,
            'count', d.count,
            'expected', d.price::bigint * d.count,
            'clients', d.clients
          )
          order by d.group_id is null, lower(d.group_name), d.group_id
        )
        from debtor_groups d
      ), '[]'::jsonb)
    )
  );
end;
$$;

comment on function public.report_month(date, date) is
  'Owner only. Money of p_month (Asia/Almaty) by method and group, and debtors on p_today.';

-- Exports ----------------------------------------------------------------------------------------

-- Checks the role and the limit, and records the export in the audit log (ids, counts and the
-- format only: never names or phones). 20 exports an hour per employee; a lock per employee makes
-- parallel requests wait for each other, so they cannot all pass the check at once.
create function public.begin_export(p_entity text, p_format text, p_details jsonb)
returns void
language plpgsql
set search_path = ''
as $$
declare
  v_actor uuid := (select auth.uid());
begin
  perform public.require_staff_role(array['owner']);
  if p_entity is null or p_entity not in ('payment', 'client')
     or p_format is null or p_format not in ('xlsx', 'csv') then
    raise exception 'invalid_export' using errcode = '22023';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('export:' || v_actor::text, 0)
  );
  if (
    select count(*)
    from public.audit_log a
    where a.actor_id = v_actor
      and a.action = 'report.export'
      and a.created_at > now() - interval '1 hour'
  ) >= 20 then
    raise exception 'rate_limited' using errcode = 'P0001';
  end if;

  insert into public.audit_log (actor_id, action, entity, details)
  values (
    v_actor, 'report.export', p_entity,
    coalesce(p_details, '{}'::jsonb) || jsonb_build_object('format', p_format)
  );
end;
$$;

-- Payments and reversals recorded in p_month, oldest first. Opening balances are not money and
-- are left out, as in the report.
create function public.export_payments(p_month date, p_format text)
returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  v_rows jsonb;
begin
  perform public.require_staff_role(array['owner']);
  perform public.report_month_bounds(p_month);

  select coalesce(jsonb_agg(
    jsonb_build_object(
      'created_at', p.created_at,
      'kind', p.kind,
      'last_name', c.last_name,
      'first_name', c.first_name,
      'group_name', g.name,
      'amount', p.amount,
      'method', p.method,
      'period_start', p.period_start,
      'period_end', p.period_end,
      'reason', p.reason,
      'reversed', exists (select 1 from public.payments r where r.reverses_id = p.id),
      'created_by', s.full_name
    )
    order by p.created_at, p.id
  ), '[]'::jsonb)
  into v_rows
  from public.payments p
  join public.clients c on c.id = p.client_id
  left join public.groups g on g.id = c.group_id
  left join public.staff s on s.id = p.created_by
  cross join public.report_month_bounds(p_month) b
  where p.kind in ('payment', 'reversal')
    and p.created_at >= b.starts_at
    and p.created_at < b.ends_at;

  perform public.begin_export(
    'payment', p_format,
    jsonb_build_object('month', to_char(p_month, 'YYYY-MM'), 'rows', jsonb_array_length(v_rows))
  );
  return v_rows;
end;
$$;

-- All clients on file (archived too, deleted ones never) with their status on p_today, by name.
create function public.export_clients(
  p_format text,
  p_today date default (now() at time zone 'Asia/Almaty')::date
)
returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  v_rows jsonb;
begin
  perform public.require_staff_role(array['owner']);

  select coalesce(jsonb_agg(
    jsonb_build_object(
      'last_name', c.last_name,
      'first_name', c.first_name,
      'phone', c.phone,
      'phone_owner', c.phone_owner,
      'parent_name', c.parent_name,
      'birth_date', c.birth_date,
      'group_name', g.name,
      'started_on', c.started_on,
      'status', cs.status,
      'ends_on', cs.ends_on,
      'archived', c.archived_at is not null,
      'note', c.note
    )
    order by lower(c.last_name), lower(c.first_name), c.id
  ), '[]'::jsonb)
  into v_rows
  from public.clients c
  join public.client_status(p_today) cs on cs.client_id = c.id
  left join public.groups g on g.id = c.group_id
  where c.deleted_at is null;

  perform public.begin_export(
    'client', p_format, jsonb_build_object('rows', jsonb_array_length(v_rows))
  );
  return v_rows;
end;
$$;

grant execute on function public.report_month_bounds(date) to authenticated, service_role;
grant execute on function public.report_month(date, date) to authenticated, service_role;
grant execute on function public.begin_export(text, text, jsonb) to authenticated, service_role;
grant execute on function public.export_payments(date, text) to authenticated, service_role;
grant execute on function public.export_clients(text, date) to authenticated, service_role;
