-- Payment period (step 18, decisions D-03 and D-16 of 2026-11-17).
--
-- D-03: a subscription is renewed from the day after its old end, so paying a few days late gives
-- no free days. Only a client who stayed away longer than the next month (paid after that month
-- would have ended) starts again on the payment day; otherwise they would pay and still be in debt.
-- D-16: the person recording the payment may set the last day ("valid until") themselves, within
-- bounds the database checks. Payments recorded before this migration keep their periods.

-- Period -----------------------------------------------------------------------------------------

-- Last day of a period of p_months starting on p_start: the day before the same day number
-- p_months later, or the end of a shorter month (31 January: 28/29 February).
-- periodEnd() in src/features/payments/period.ts is the same function.
create function public.period_last_day(p_start date, p_months integer)
returns date
language plpgsql
immutable
set search_path = ''
as $$
declare
  -- Adding months clamps to the end of a shorter month (31 Jan + 1 month = 28 Feb).
  v_target date := (p_start + make_interval(months => p_months))::date;
begin
  return case
    when extract(day from v_target) < extract(day from p_start) then v_target
    else v_target - 1
  end;
end;
$$;

-- The period a payment made on p_paid_on gets by default. src/features/payments/period.ts
-- (nextPeriod) is the same rule for the form; an integration test keeps the two equal.
create or replace function public.next_period(
  p_current_end date,
  p_paid_on date,
  p_months integer default 1
)
returns table (period_start date, period_end date)
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_start date;
begin
  if p_paid_on is null or p_months is null or p_months not between 1 and 12 then
    raise exception 'invalid_period' using errcode = '22023';
  end if;
  -- Valid now, or paid within the month after the old end: continue from the old end.
  v_start := case
    when p_current_end is not null
      and p_paid_on <= public.period_last_day(p_current_end + 1, 1) then p_current_end + 1
    else p_paid_on
  end;
  period_start := v_start;
  period_end := public.period_last_day(v_start, p_months);
  return next;
end;
$$;

-- Earliest and latest last day the person recording a payment may choose.
-- STUB(D-16): bounds proposed by the developer, the customer may change them. Not before the
-- payment day (the client would be in debt again at once) nor before the start of the period, and
-- not later than the end of 12 months from the start.
create function public.period_end_bounds(p_period_start date, p_paid_on date)
returns table (min_end date, max_end date)
language sql
immutable
set search_path = ''
as $$
  select greatest(p_paid_on, p_period_start), public.period_last_day(p_period_start, 12);
$$;

-- record_payment ---------------------------------------------------------------------------------

-- The new optional argument changes the signature: the old function goes, so a call with five
-- arguments cannot pick a stale overload.
drop function public.record_payment(uuid, integer, text, uuid, integer);

-- Records a payment for the client. The period start always comes from the server's date and the
-- client's history; p_period_end (optional) replaces the default last day and is checked here, so
-- a request that bypasses the form cannot store a period outside the bounds. A repeated request
-- with the same key returns the first payment (created: false); the same key with different data
-- is refused.
create function public.record_payment(
  p_client_id uuid,
  p_amount integer,
  p_method text,
  p_idempotency_key uuid,
  p_months integer default 1,
  p_period_end date default null
)
returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  v_client public.clients;
  v_existing public.payments;
  v_payment public.payments;
  v_current_end date;
  v_paid_on date := (now() at time zone 'Asia/Almaty')::date;
  v_period record;
  v_bounds record;
  v_end date;
begin
  perform public.require_staff_role(array['owner', 'admin']);
  if p_idempotency_key is null
     or p_amount is null or p_amount not between 1 and 10000000
     or p_method is null or p_method not in ('cash', 'kaspi', 'transfer')
     or p_months is null or p_months not between 1 and 12 then
    raise exception 'invalid_payment' using errcode = '22023';
  end if;

  -- One payment of a client at a time: the second builds its period on the first, and a resent
  -- request waits here until the first has committed, then finds it by key below.
  select * into v_client from public.clients c where c.id = p_client_id for update;
  if not found or v_client.deleted_at is not null then
    raise exception 'client_not_found' using errcode = 'P0002';
  end if;

  select * into v_existing from public.payments p where p.idempotency_key = p_idempotency_key;
  if found then
    if v_existing.kind <> 'payment'
       or v_existing.client_id <> p_client_id
       or v_existing.amount <> p_amount
       or v_existing.method <> p_method
       or (p_period_end is not null and v_existing.period_end <> p_period_end) then
      raise exception 'idempotency_conflict' using errcode = '23505';
    end if;
    return public.payment_json(v_existing, false);
  end if;

  -- An imported subscription (import_balance) is renewed like a paid one.
  select max(p.period_end) into v_current_end
  from public.payments p
  where p.client_id = p_client_id
    and p.kind in ('payment', 'import_balance')
    and not exists (select 1 from public.payments r where r.reverses_id = p.id);

  select * into v_period from public.next_period(v_current_end, v_paid_on, p_months);

  v_end := coalesce(p_period_end, v_period.period_end);
  if p_period_end is not null then
    select * into v_bounds from public.period_end_bounds(v_period.period_start, v_paid_on);
    if p_period_end not between v_bounds.min_end and v_bounds.max_end then
      raise exception 'period_end_out_of_range' using errcode = '22023';
    end if;
  end if;

  insert into public.payments (
    client_id, kind, amount, method, period_start, period_end, idempotency_key, created_by
  ) values (
    p_client_id, 'payment', p_amount, p_method, v_period.period_start, v_end,
    p_idempotency_key, (select auth.uid())
  )
  -- The same key used for another client by a parallel request (the client lock does not cover it).
  on conflict (idempotency_key) do nothing
  returning * into v_payment;
  if not found then
    raise exception 'idempotency_conflict' using errcode = '23505';
  end if;

  -- Ids, amount and dates only: the audit log never holds names or phones. A last day chosen by
  -- hand is marked, with the default one, so the owner sees it in the journal.
  insert into public.audit_log (actor_id, action, entity, entity_id, details)
  values (
    (select auth.uid()), 'payment.create', 'payment', v_payment.id,
    jsonb_build_object(
      'client_id', p_client_id,
      'amount', p_amount,
      'method', p_method,
      'period_start', v_payment.period_start,
      'period_end', v_payment.period_end
    ) || case
      when v_payment.period_end <> v_period.period_end then jsonb_build_object(
        'period_end_changed', true,
        'rule_period_end', v_period.period_end
      )
      else '{}'::jsonb
    end
  );
  return public.payment_json(v_payment, true);
end;
$$;

grant execute on function public.period_last_day(date, integer) to authenticated, service_role;
grant execute on function public.period_end_bounds(date, date) to authenticated, service_role;
grant execute on function public.record_payment(uuid, integer, text, uuid, integer, date)
  to authenticated, service_role;
