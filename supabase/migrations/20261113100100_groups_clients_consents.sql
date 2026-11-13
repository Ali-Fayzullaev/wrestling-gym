-- Groups, clients and consents.

-- groups ---------------------------------------------------------------------------------------

create table public.groups (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(btrim(name)) between 1 and 100),
  coach_id uuid not null references public.staff (id) on delete restrict,
  -- Array of {"day": 1..7 (ISO, Monday = 1), "start": "HH:MM", "end": "HH:MM"}; the shape is
  -- validated by Zod in the groups step, the database only guarantees it is a list.
  schedule jsonb not null default '[]'::jsonb check (jsonb_typeof(schedule) = 'array'),
  -- STUB(D-02): one monthly price per group; other subscription kinds wait for the decision.
  default_price integer not null check (default_price > 0),
  capacity integer check (capacity > 0),
  archived_at timestamptz,
  created_at timestamptz not null default now()
);

alter table public.groups enable row level security;

create index groups_coach_id_idx on public.groups (coach_id);

create policy groups_select on public.groups
  for select to authenticated
  using ((select public.current_staff_role()) in ('owner', 'admin'));

create policy groups_insert on public.groups
  for insert to authenticated
  with check ((select public.current_staff_role()) = 'owner');

create policy groups_update on public.groups
  for update to authenticated
  using ((select public.current_staff_role()) = 'owner')
  with check ((select public.current_staff_role()) = 'owner');

-- clients --------------------------------------------------------------------------------------

create table public.clients (
  id uuid primary key default gen_random_uuid(),
  last_name text not null check (char_length(btrim(last_name)) between 1 and 100),
  first_name text not null check (char_length(btrim(first_name)) between 1 and 100),
  birth_date date,
  phone text not null check (phone ~ '^\+77\d{9}$'),
  phone_owner text not null check (phone_owner in ('self', 'parent')),
  parent_name text check (parent_name is null or char_length(btrim(parent_name)) between 1 and 100),
  group_id uuid references public.groups (id) on delete restrict,
  started_on date not null,
  note text not null default '' check (char_length(note) <= 2000),
  archived_at timestamptz,
  created_by uuid not null default auth.uid() references public.staff (id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  search_text text generated always as (
    public.normalize_search(last_name || ' ' || first_name || ' ' || phone)
  ) stored,
  -- A child's contact phone belongs to a parent; reminders address the parent by name.
  constraint clients_parent_name_required check (phone_owner = 'self' or parent_name is not null)
);

comment on column public.clients.search_text is
  'normalize_search(last_name first_name phone); query with normalize_search(input).';

alter table public.clients enable row level security;

create index clients_group_id_idx on public.clients (group_id);
create index clients_archived_at_idx on public.clients (archived_at);
create index clients_search_text_trgm_idx on public.clients
  using gin (search_text extensions.gin_trgm_ops);

create function public.keep_client_authorship()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.created_by := old.created_by;
  new.created_at := old.created_at;
  return new;
end;
$$;

create trigger clients_keep_authorship
  before update on public.clients
  for each row execute function public.keep_client_authorship();

create trigger clients_set_updated_at
  before update on public.clients
  for each row execute function public.set_updated_at();

create policy clients_select on public.clients
  for select to authenticated
  using ((select public.current_staff_role()) in ('owner', 'admin'));

create policy clients_insert on public.clients
  for insert to authenticated
  with check (
    (select public.current_staff_role()) in ('owner', 'admin')
    and created_by = (select auth.uid())
  );

-- Archiving is an update, so both roles may do it; only a full delete is reserved for the owner.
create policy clients_update on public.clients
  for update to authenticated
  using ((select public.current_staff_role()) in ('owner', 'admin'))
  with check ((select public.current_staff_role()) in ('owner', 'admin'));

create policy clients_delete on public.clients
  for delete to authenticated
  using ((select public.current_staff_role()) = 'owner');

-- consents (append-only) -----------------------------------------------------------------------

create table public.consents (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients (id) on delete restrict,
  -- STUB(D-10): only the fact, date and recorder are stored; the consent text awaits legal review.
  kind text not null check (kind in ('data_processing', 'messaging')),
  given_on date not null,
  recorded_by uuid not null default auth.uid() references public.staff (id) on delete restrict,
  created_at timestamptz not null default now()
);

alter table public.consents enable row level security;

create index consents_client_id_idx on public.consents (client_id);

create trigger consents_append_only
  before update or delete on public.consents
  for each row execute function public.forbid_change();

create trigger consents_no_truncate
  before truncate on public.consents
  for each statement execute function public.forbid_change();

create policy consents_select on public.consents
  for select to authenticated
  using ((select public.current_staff_role()) in ('owner', 'admin'));

create policy consents_insert on public.consents
  for insert to authenticated
  with check (
    (select public.current_staff_role()) in ('owner', 'admin')
    and recorded_by = (select auth.uid())
  );
