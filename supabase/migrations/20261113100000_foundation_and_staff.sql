-- Foundation: extensions, shared helper functions, staff and the role helper used by every policy.
--
-- Conventions for the whole schema:
--   * enumerations are `text` + `check (... in (...))`;
--   * money is `integer` tenge, dates of subscriptions are `date`, instants are `timestamptz`;
--   * business dates are computed in Asia/Almaty (UTC+5);
--   * RLS is enabled in the same migration that creates a table.

create extension if not exists pg_trgm with schema extensions;
create extension if not exists unaccent with schema extensions;

-- unaccent() is only STABLE (its dictionary could change), so it cannot back an index or a
-- generated column directly. Pinning the dictionary makes the result deterministic.
create function public.normalize_search(p_text text)
returns text
language sql
immutable
strict
parallel safe
set search_path = ''
as $$
  select lower(extensions.unaccent('extensions.unaccent'::regdictionary, p_text));
$$;

comment on function public.normalize_search(text) is
  'Lower-cased, accent-free text for trigram search; apply to both the indexed column and the query.';

-- Append-only tables (payments, consents, audit_log) raise here on UPDATE, DELETE and TRUNCATE,
-- whoever the caller is: missing policies alone would not stop service_role or the table owner.
create function public.forbid_change()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception 'append-only table %: % is not allowed', tg_table_name, tg_op
    using errcode = 'P0001', hint = 'Record a new row (for payments, a reversal) instead.';
end;
$$;

create function public.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

-- staff ----------------------------------------------------------------------------------------

create table public.staff (
  -- Staff are deactivated, never deleted: payments and audit rows keep pointing at them.
  id uuid primary key references auth.users (id) on delete restrict,
  full_name text not null check (char_length(btrim(full_name)) between 1 and 100),
  role text not null check (role in ('owner', 'admin')),
  active boolean not null default true,
  created_at timestamptz not null default now()
);

comment on table public.staff is 'Gym employees who can sign in. Clients never sign in.';

alter table public.staff enable row level security;

-- Returns the caller's role only while the staff row is active, so a deactivated employee loses
-- access on the very next query. SECURITY DEFINER lets policies read staff without recursing into
-- staff's own policies.
create function public.current_staff_role()
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select s.role
  from public.staff s
  where s.id = (select auth.uid())
    and s.active;
$$;

comment on function public.current_staff_role() is
  'owner | admin for the signed-in active employee, otherwise null.';

-- Coach names are needed on group screens and filters, so every employee sees the staff list.
create policy staff_select on public.staff
  for select to authenticated
  using ((select public.current_staff_role()) in ('owner', 'admin'));

create policy staff_insert on public.staff
  for insert to authenticated
  with check ((select public.current_staff_role()) = 'owner');

create policy staff_update on public.staff
  for update to authenticated
  using ((select public.current_staff_role()) = 'owner')
  with check ((select public.current_staff_role()) = 'owner');
