-- Import of existing clients from the paper notebook, typed into CSV or Excel (step 10).
--
-- The file is parsed on the server (src/features/import); the database receives checked rows and
-- writes them in one transaction: clients, new groups, an opening balance per client and one audit
-- row with the file hash. Everything runs as the caller (security invoker): RLS and grants decide.
-- STUB(D-09): owner only; admins could be allowed if the customer decides so.

-- Opening balance ------------------------------------------------------------------------------

-- The end date written in the notebook becomes an "import_balance" row: amount 0, no payment
-- method, reason "перенос из тетради". client_status() then treats it like any subscription, and
-- the history shows honestly that the system received no money for it. It cannot be reversed
-- (check_reversal() only accepts a payment); a newer payment supersedes it as usual.
alter table public.payments alter column method drop not null;

alter table public.payments drop constraint payments_kind_check;
alter table public.payments
  add constraint payments_kind_check check (kind in ('payment', 'reversal', 'import_balance'));

alter table public.payments drop constraint payments_kind_shape;
alter table public.payments
  add constraint payments_kind_shape check (
    (
      kind = 'payment'
      and amount > 0
      and method is not null
      and reverses_id is null
      and reason is null
    )
    or (
      kind = 'reversal'
      and amount < 0
      and method is not null
      and reverses_id is not null
      and reason is not null
      and char_length(btrim(reason)) between 1 and 500
    )
    or (
      kind = 'import_balance'
      and amount = 0
      and method is null
      and reverses_id is null
      and reason is not null
      and char_length(btrim(reason)) between 1 and 500
    )
  );

-- Only the owner imports; the rest of the policy is unchanged from step 02.
alter policy payments_insert on public.payments
  with check (
    created_by = (select auth.uid())
    and (
      (kind = 'payment' and (select public.current_staff_role()) in ('owner', 'admin'))
      or (kind = 'import_balance' and (select public.current_staff_role()) = 'owner')
      or (kind = 'reversal' and (select public.current_staff_role()) = 'owner')
      or (
        kind = 'reversal'
        and (select public.current_staff_role()) = 'admin'
        and public.is_own_recent_payment(reverses_id)
      )
    )
  );

-- A blanked (deleted) client takes no opening balance either.
create or replace function public.check_payment_client()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.kind in ('payment', 'import_balance') and exists (
    select 1 from public.clients c where c.id = new.client_id and c.deleted_at is not null
  ) then
    raise exception 'client_not_found' using errcode = 'P0002';
  end if;
  return new;
end;
$$;

-- Status: an opening balance counts as a subscription, exactly like a payment.
create or replace function public.client_status(
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
      and p.kind in ('payment', 'import_balance')
      and not exists (select 1 from public.payments r where r.reverses_id = p.id)
    order by p.period_end desc, p.created_at desc
    limit 1
  ) cur on true;
$$;

-- Reminders: an imported subscription is reminded about like a paid one.
create or replace function public.check_reminder_event_insert()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not exists (
    select 1 from public.payments p
    where p.id = new.payment_id and p.kind in ('payment', 'import_balance')
  ) then
    raise exception 'a reminder must reference a payment, not a reversal' using errcode = '23514';
  end if;
  return new;
end;
$$;

create or replace function public.record_reminder_opened(p_payment_id uuid, p_kind text)
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
  where p.id = p_payment_id and p.kind in ('payment', 'import_balance');
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

-- Renewal (STUB(D-03)): an imported subscription that is still valid is extended from its end,
-- like a paid one. Only the v_current_end query differs from step 07.
create or replace function public.record_payment(
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
    and p.kind in ('payment', 'import_balance')
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

-- Import -----------------------------------------------------------------------------------------

-- Finds earlier imports by file hash.
create index audit_log_import_hash_idx on public.audit_log ((details ->> 'file_hash'))
  where action = 'client.import';

-- What the preview needs in one call: clients already on file with one of the phones (for the
-- duplicate key phone + last name + first name), active groups to match names against, active
-- staff who can coach a group created by the import, and when this file was imported before.
-- Phones travel in the request body, never in a URL.
create function public.import_context(p_phones text[], p_file_hash text)
returns jsonb
language plpgsql
stable
set search_path = ''
as $$
begin
  perform public.require_staff_role(array['owner']);
  return jsonb_build_object(
    'existing', coalesce((
      select jsonb_agg(
        jsonb_build_object('phone', c.phone, 'last_name', c.last_name, 'first_name', c.first_name)
      )
      from public.clients c
      where c.phone = any (coalesce(p_phones, '{}'))
        and c.deleted_at is null
    ), '[]'::jsonb),
    'groups', coalesce((
      select jsonb_agg(jsonb_build_object('id', g.id, 'name', g.name) order by lower(g.name), g.id)
      from public.groups g
      where g.archived_at is null
    ), '[]'::jsonb),
    'coaches', coalesce((
      select jsonb_agg(jsonb_build_object('id', s.id, 'name', s.full_name) order by s.full_name, s.id)
      from public.staff s
      where s.active
    ), '[]'::jsonb),
    'imported_at', (
      select max(a.created_at)
      from public.audit_log a
      where a.action = 'client.import' and a.details ->> 'file_hash' = p_file_hash
    )
  );
end;
$$;

-- Same rule as groupKey() in src/features/import/group-key.ts: case, "ё" and extra spaces do not
-- make a different group.
create function public.import_group_key(p_name text)
returns text
language sql
immutable
set search_path = ''
as $$
  select replace(lower(regexp_replace(btrim(p_name), '\s+', ' ', 'g')), 'ё', 'е');
$$;

-- Imports checked rows in one transaction. A row whose duplicate key (phone + last name + first
-- name, case-insensitive) is already on file, or appeared earlier in the same file, is skipped, so
-- importing the same file again creates nothing. Rows reference an existing active group by id or
-- a group created here by name (p_new_groups: [{name, coach_id, price}]).
--
-- STUB(D-02): the notebook gives only the end date; the period is taken as the month before it.
-- The notebook does not say whose phone it is or when the client started: "self" and the import
-- date are stored, and the client card corrects them.
create function public.import_clients(
  p_file_hash text,
  p_rows jsonb,
  p_new_groups jsonb default '[]'::jsonb,
  p_today date default (now() at time zone 'Asia/Almaty')::date
)
returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  v_actor uuid := (select auth.uid());
  v_group jsonb;
  v_group_ids jsonb := '{}'::jsonb;
  v_created_groups uuid[] := '{}';
  v_group_id uuid;
  v_row record;
  v_client_id uuid;
  v_created integer := 0;
  v_duplicates integer := 0;
begin
  perform public.require_staff_role(array['owner']);
  if p_file_hash is null or p_file_hash !~ '^[0-9a-f]{64}$'
     or p_rows is null or jsonb_typeof(p_rows) <> 'array'
     or jsonb_array_length(p_rows) not between 1 and 2000
     or p_new_groups is null or jsonb_typeof(p_new_groups) <> 'array'
     or jsonb_array_length(p_new_groups) > 50 then
    raise exception 'invalid_import' using errcode = '22023';
  end if;

  -- One import at a time: a parallel import of the same file waits and then finds every row on
  -- file, so it creates nothing.
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('import_clients', 0));

  if (
    select count(*)
    from public.audit_log a
    where a.actor_id = v_actor
      and a.action = 'client.import'
      and a.created_at > now() - interval '1 hour'
  ) >= 10 then
    raise exception 'rate_limited' using errcode = 'P0001';
  end if;

  for v_group in select * from jsonb_array_elements(p_new_groups) loop
    if v_group_ids ? public.import_group_key(v_group ->> 'name') then
      raise exception 'invalid_import' using errcode = '22023';
    end if;
    v_group_id := public.create_group(
      v_group ->> 'name', (v_group ->> 'coach_id')::uuid, '[]'::jsonb, (v_group ->> 'price')::integer
    );
    v_group_ids := v_group_ids
      || jsonb_build_object(public.import_group_key(v_group ->> 'name'), v_group_id);
    v_created_groups := array_append(v_created_groups, v_group_id);
  end loop;

  for v_row in
    select r.*
    from jsonb_to_recordset(p_rows) as r (
      line integer,
      last_name text,
      first_name text,
      phone text,
      group_id uuid,
      new_group text,
      ends_on date
    )
    order by r.line
  loop
    if exists (
      select 1 from public.clients c
      where c.phone = v_row.phone
        and lower(c.last_name) = lower(btrim(v_row.last_name))
        and lower(c.first_name) = lower(btrim(v_row.first_name))
        and c.deleted_at is null
    ) then
      v_duplicates := v_duplicates + 1;
      continue;
    end if;

    if v_row.new_group is not null then
      v_group_id := (v_group_ids ->> public.import_group_key(v_row.new_group))::uuid;
      if v_group_id is null then
        raise exception 'group_not_found' using errcode = 'P0002';
      end if;
    else
      v_group_id := v_row.group_id;
      perform public.check_client_group(v_group_id);
    end if;

    insert into public.clients (
      last_name, first_name, phone, phone_owner, group_id, started_on, created_by
    ) values (
      btrim(v_row.last_name), btrim(v_row.first_name), v_row.phone, 'self', v_group_id, p_today,
      v_actor
    )
    returning id into v_client_id;

    if v_row.ends_on is not null then
      insert into public.payments (
        client_id, kind, amount, method, period_start, period_end, reason, idempotency_key,
        created_by
      ) values (
        v_client_id, 'import_balance', 0, null,
        least((v_row.ends_on - interval '1 month')::date + 1, v_row.ends_on), v_row.ends_on,
        'Перенос из тетради', gen_random_uuid(), v_actor
      );
    end if;
    v_created := v_created + 1;
  end loop;

  -- Counts, ids and the file hash only: the audit log never holds names or phones.
  insert into public.audit_log (actor_id, action, entity, details)
  values (
    v_actor, 'client.import', 'client',
    jsonb_build_object(
      'file_hash', p_file_hash,
      'rows', jsonb_array_length(p_rows),
      'created', v_created,
      'duplicates', v_duplicates,
      'groups_created', to_jsonb(v_created_groups)
    )
  );

  return jsonb_build_object(
    'created', v_created,
    'duplicates', v_duplicates,
    'groups_created', cardinality(v_created_groups)
  );
end;
$$;

grant execute on function public.import_group_key(text) to authenticated, service_role;
grant execute on function public.import_context(text[], text) to authenticated, service_role;
grant execute on function public.import_clients(text, jsonb, jsonb, date)
  to authenticated, service_role;
