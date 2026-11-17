-- Payments (step 07): record a payment, reverse one, cancel one right away; the payment history on
-- the client card and the group price in the payment form.
--
-- Writes are functions so the payment and its audit row commit together or not at all. They run as
-- the caller (security invoker): RLS and grants on payments still decide who may write what.
-- Idempotency rests on payments.idempotency_key (unique): a repeated request returns the payment
-- the first one created.

-- Period ---------------------------------------------------------------------------------------

-- Superseded by *_payment_period.sql (step 18, D-03 decided). Original rule: a subscription still valid on the payment day is extended from the day after its
-- end; an expired one (or none) starts on the payment day. The period runs to the day before the
-- same day number p_months later, or to the end of a shorter month (31 January: 28/29 February).
-- src/features/payments/period.ts is the same rule for the form preview; a test keeps them equal.
create function public.next_period(
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
  v_target date;
begin
  if p_paid_on is null or p_months is null or p_months not between 1 and 12 then
    raise exception 'invalid_period' using errcode = '22023';
  end if;
  v_start := case
    when p_current_end is not null and p_current_end >= p_paid_on then p_current_end + 1
    else p_paid_on
  end;
  -- Adding months clamps to the end of a shorter month (31 Jan + 1 month = 28 Feb).
  v_target := (v_start + make_interval(months => p_months))::date;
  period_start := v_start;
  period_end := case
    when extract(day from v_target) < extract(day from v_start) then v_target
    else v_target - 1
  end;
  return next;
end;
$$;

-- No payments for a deleted client --------------------------------------------------------------

-- A deleted client (personal data blanked, deleted_at set) keeps its money history but takes no new
-- payments. record_payment() refuses first with a clear error; this trigger also stops a direct
-- INSERT, which staff still have a grant for.
create function public.check_payment_client()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.kind = 'payment' and exists (
    select 1 from public.clients c where c.id = new.client_id and c.deleted_at is not null
  ) then
    raise exception 'client_not_found' using errcode = 'P0002';
  end if;
  return new;
end;
$$;

create trigger payments_check_client
  before insert on public.payments
  for each row execute function public.check_payment_client();

-- Writes -----------------------------------------------------------------------------------------

create function public.payment_json(p public.payments, p_created boolean)
returns jsonb
language sql
immutable
set search_path = ''
as $$
  select jsonb_build_object(
    'id', p.id,
    'client_id', p.client_id,
    'kind', p.kind,
    'amount', p.amount,
    'method', p.method,
    'period_start', p.period_start,
    'period_end', p.period_end,
    'reverses_id', p.reverses_id,
    'created_at', p.created_at,
    'created', p_created
  );
$$;

-- Records a payment for the client. The period is computed here from the server's date, never sent
-- by the browser. A repeated request with the same key returns the first payment (created: false);
-- the same key with different data is refused.
create function public.record_payment(
  p_client_id uuid,
  p_amount integer,
  p_method text,
  p_idempotency_key uuid,
  p_months integer default 1
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
  v_period record;
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
       or v_existing.method <> p_method then
      raise exception 'idempotency_conflict' using errcode = '23505';
    end if;
    return public.payment_json(v_existing, false);
  end if;

  select max(p.period_end) into v_current_end
  from public.payments p
  where p.client_id = p_client_id
    and p.kind = 'payment'
    and not exists (select 1 from public.payments r where r.reverses_id = p.id);

  select * into v_period
  from public.next_period(v_current_end, (now() at time zone 'Asia/Almaty')::date, p_months);

  insert into public.payments (
    client_id, kind, amount, method, period_start, period_end, idempotency_key, created_by
  ) values (
    p_client_id, 'payment', p_amount, p_method, v_period.period_start, v_period.period_end,
    p_idempotency_key, (select auth.uid())
  )
  -- The same key used for another client by a parallel request (the client lock does not cover it).
  on conflict (idempotency_key) do nothing
  returning * into v_payment;
  if not found then
    raise exception 'idempotency_conflict' using errcode = '23505';
  end if;

  -- Ids, amount and period only: the audit log never holds names or phones.
  insert into public.audit_log (actor_id, action, entity, entity_id, details)
  values (
    (select auth.uid()), 'payment.create', 'payment', v_payment.id,
    jsonb_build_object(
      'client_id', p_client_id,
      'amount', p_amount,
      'method', p_method,
      'period_start', v_payment.period_start,
      'period_end', v_payment.period_end
    )
  );
  return public.payment_json(v_payment, true);
end;
$$;

-- A reversal row cancelling p_payment_id: shared by reverse_payment() (owner, with a reason) and
-- cancel_recent_payment() (its author or the owner, within 10 minutes). Replays by key return the
-- first reversal.
create function public.insert_reversal(
  p_payment_id uuid,
  p_reason text,
  p_idempotency_key uuid,
  p_cancel boolean
)
returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  v_original public.payments;
  v_existing public.payments;
  v_reversal public.payments;
begin
  perform public.require_staff_role(
    case when p_cancel then array['owner', 'admin'] else array['owner'] end
  );
  if p_idempotency_key is null
     or p_reason is null or char_length(btrim(p_reason)) not between 1 and 500 then
    raise exception 'invalid_reversal' using errcode = '22023';
  end if;

  select * into v_original from public.payments p where p.id = p_payment_id;
  if not found or v_original.kind <> 'payment' then
    raise exception 'payment_not_found' using errcode = 'P0002';
  end if;
  -- Serialised with record_payment() of the same client, so a new period is never built on a
  -- payment that is being reversed at that moment.
  perform 1 from public.clients c where c.id = v_original.client_id for update;

  select * into v_existing from public.payments p where p.idempotency_key = p_idempotency_key;
  if found then
    if v_existing.kind <> 'reversal' or v_existing.reverses_id <> p_payment_id then
      raise exception 'idempotency_conflict' using errcode = '23505';
    end if;
    return public.payment_json(v_existing, false);
  end if;

  if exists (select 1 from public.payments r where r.reverses_id = p_payment_id) then
    raise exception 'already_reversed' using errcode = '23505';
  end if;

  if p_cancel then
    if v_original.created_by <> (select auth.uid())
       and public.current_staff_role() <> 'owner' then
      raise exception 'forbidden' using errcode = '42501';
    end if;
    if v_original.created_at <= now() - interval '10 minutes' then
      raise exception 'cancel_window_passed' using errcode = '22023';
    end if;
  end if;

  insert into public.payments (
    client_id, kind, amount, method, period_start, period_end, reverses_id, reason,
    idempotency_key, created_by
  ) values (
    v_original.client_id, 'reversal', -v_original.amount, v_original.method,
    v_original.period_start, v_original.period_end, p_payment_id, btrim(p_reason),
    p_idempotency_key, (select auth.uid())
  )
  on conflict (idempotency_key) do nothing
  returning * into v_reversal;
  if not found then
    raise exception 'idempotency_conflict' using errcode = '23505';
  end if;

  -- The reason is free text and may name someone: it stays in payments, not in the audit log.
  insert into public.audit_log (actor_id, action, entity, entity_id, details)
  values (
    (select auth.uid()),
    case when p_cancel then 'payment.cancel' else 'payment.reverse' end,
    'payment',
    v_reversal.id,
    jsonb_build_object(
      'client_id', v_original.client_id,
      'reverses_id', p_payment_id,
      'amount', v_reversal.amount
    )
  );
  return public.payment_json(v_reversal, true);
end;
$$;

-- Owner only: cancels any payment with a reversal and a reason.
create function public.reverse_payment(
  p_payment_id uuid,
  p_reason text,
  p_idempotency_key uuid
)
returns jsonb
language sql
set search_path = ''
as $$
  select public.insert_reversal(p_payment_id, p_reason, p_idempotency_key, false);
$$;

-- "Cancel" right after recording: the author (or the owner) within 10 minutes; later only the
-- owner's reversal. Stored as a reversal with a fixed reason.
create function public.cancel_recent_payment(p_payment_id uuid, p_idempotency_key uuid)
returns jsonb
language sql
set search_path = ''
as $$
  select public.insert_reversal(p_payment_id, 'Отменено сразу', p_idempotency_key, true);
$$;

-- Reads ------------------------------------------------------------------------------------------

-- The /clients screen, as in step 06, plus each group's price for the payment form.
create or replace function public.clients_screen(
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
          'archived', g.archived_at is not null,
          'price', g.default_price
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

-- The /clients/[id] screen, as in step 06, plus the group price and the payment history (payments
-- and reversals, newest first, with who recorded them), so the card stays one database call.
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

grant execute on function public.next_period(date, date, integer) to authenticated, service_role;
grant execute on function public.payment_json(public.payments, boolean)
  to authenticated, service_role;
grant execute on function public.record_payment(uuid, integer, text, uuid, integer)
  to authenticated, service_role;
grant execute on function public.insert_reversal(uuid, text, uuid, boolean)
  to authenticated, service_role;
grant execute on function public.reverse_payment(uuid, text, uuid) to authenticated, service_role;
grant execute on function public.cancel_recent_payment(uuid, uuid) to authenticated, service_role;
