-- Sign-in and password-reset throttling by email and by client IP.
--
-- Supabase Auth only sees the Next.js server's address, so its own per-IP limit cannot tell staff
-- apart. The app therefore counts attempts here before calling Auth. Emails and IPs are stored as
-- SHA-256 hex digests computed in the app: the table holds no personal data in readable form.
--
-- Only the server (service_role) touches this table and these functions; anon and authenticated
-- have no grants, so nobody can read the attempts or lock someone out through the public API.

create table public.auth_attempts (
  id uuid primary key default gen_random_uuid(),
  action text not null check (action in ('login', 'password_reset')),
  -- 'attempt' is written before Auth is called, so a parallel burst is counted in full;
  -- 'success' resets the per-email counter for login.
  outcome text not null check (outcome in ('attempt', 'success')),
  email_hash text not null check (email_hash ~ '^[0-9a-f]{64}$'),
  ip_hash text not null check (ip_hash ~ '^[0-9a-f]{64}$'),
  created_at timestamptz not null
);

comment on table public.auth_attempts is
  'Throttle ledger for sign-in and password reset. Hashed keys only; rows older than a day are pruned.';

alter table public.auth_attempts enable row level security;
-- No policies: only service_role (which bypasses RLS) may use the table.

create index auth_attempts_email_idx on public.auth_attempts (action, email_hash, created_at desc);
create index auth_attempts_ip_idx on public.auth_attempts (action, ip_hash, created_at desc);
create index auth_attempts_created_at_idx on public.auth_attempts (created_at);

revoke all on public.auth_attempts from public, anon, authenticated;

-- Limits live in one place so the app and the tests read the same numbers.
create function public.auth_throttle_limits(p_action text)
returns table (email_limit integer, ip_limit integer, window_length interval)
language sql
immutable
set search_path = ''
as $$
  select l.email_limit, l.ip_limit, interval '15 minutes'
  from (
    values ('login', 5, 20), ('password_reset', 3, 10)
  ) as l (action, email_limit, ip_limit)
  where l.action = p_action;
$$;

-- When the newest `p_limit` counted attempts all fall inside the window, the caller may try again
-- once the oldest of them leaves it (a sliding window). Returns null when under the limit.
create function public.auth_throttle_retry_at(
  p_action text,
  p_email_hash text,
  p_ip_hash text,
  p_limit integer,
  p_since timestamptz,
  p_window interval
)
returns timestamptz
language sql
stable
set search_path = ''
as $$
  select a.created_at + p_window
  from public.auth_attempts a
  where a.action = p_action
    and a.outcome = 'attempt'
    and a.created_at > p_since
    and (p_email_hash is null or a.email_hash = p_email_hash)
    and (p_ip_hash is null or a.ip_hash = p_ip_hash)
  order by a.created_at desc
  offset p_limit - 1
  limit 1;
$$;

-- Checks both limits and, when allowed, records the attempt in the same transaction.
-- `p_now` comes from the app so tests can move the clock.
create function public.auth_throttle_begin(
  p_action text,
  p_email_hash text,
  p_ip_hash text,
  p_now timestamptz
)
returns table (allowed boolean, limited_by text, retry_after_seconds integer)
language plpgsql
set search_path = ''
as $$
declare
  v_limits record;
  v_last_success timestamptz;
  v_email_retry timestamptz;
  v_ip_retry timestamptz;
  v_retry timestamptz;
begin
  select * into v_limits from public.auth_throttle_limits(p_action);
  if not found then
    raise exception 'unknown auth action' using errcode = '22023';
  end if;

  -- Serialise attempts on the same email and on the same IP: without the locks a parallel burst
  -- would pass the check before any of its attempts is counted. Email is always locked first,
  -- so two transactions never wait on each other in opposite order.
  perform pg_advisory_xact_lock(hashtextextended('auth_attempts:email:' || p_email_hash, 0));
  perform pg_advisory_xact_lock(hashtextextended('auth_attempts:ip:' || p_ip_hash, 0));

  select max(a.created_at) into v_last_success
  from public.auth_attempts a
  where a.action = p_action and a.outcome = 'success' and a.email_hash = p_email_hash;

  v_email_retry := public.auth_throttle_retry_at(
    p_action, p_email_hash, null, v_limits.email_limit,
    greatest(p_now - v_limits.window_length, coalesce(v_last_success, '-infinity')),
    v_limits.window_length
  );
  -- A success does not reset the IP counter: one valid account must not unlock guessing others.
  v_ip_retry := public.auth_throttle_retry_at(
    p_action, null, p_ip_hash, v_limits.ip_limit,
    p_now - v_limits.window_length,
    v_limits.window_length
  );

  v_retry := greatest(v_email_retry, v_ip_retry);
  if v_retry is not null and v_retry > p_now then
    return query select
      false,
      case when v_retry = v_email_retry then 'email' else 'ip' end,
      ceil(extract(epoch from v_retry - p_now))::integer;
    return;
  end if;

  delete from public.auth_attempts where created_at < p_now - interval '1 day';

  insert into public.auth_attempts (action, outcome, email_hash, ip_hash, created_at)
  values (p_action, 'attempt', p_email_hash, p_ip_hash, p_now);

  return query select true, null::text, 0;
end;
$$;

create function public.auth_throttle_success(
  p_action text,
  p_email_hash text,
  p_ip_hash text,
  p_now timestamptz
)
returns void
language sql
set search_path = ''
as $$
  insert into public.auth_attempts (action, outcome, email_hash, ip_hash, created_at)
  values (p_action, 'success', p_email_hash, p_ip_hash, p_now);
$$;

revoke all on function public.auth_throttle_limits(text) from public, anon, authenticated;
revoke all on function public.auth_throttle_retry_at(text, text, text, integer, timestamptz, interval)
  from public, anon, authenticated;
revoke all on function public.auth_throttle_begin(text, text, text, timestamptz)
  from public, anon, authenticated;
revoke all on function public.auth_throttle_success(text, text, text, timestamptz)
  from public, anon, authenticated;

grant execute on function public.auth_throttle_limits(text) to service_role;
grant execute on function public.auth_throttle_retry_at(text, text, text, integer, timestamptz, interval)
  to service_role;
grant execute on function public.auth_throttle_begin(text, text, text, timestamptz) to service_role;
grant execute on function public.auth_throttle_success(text, text, text, timestamptz) to service_role;
