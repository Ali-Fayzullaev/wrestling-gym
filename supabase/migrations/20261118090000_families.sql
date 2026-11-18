-- A parent and their children (step 21, D-18, D-19).
--
-- A parent is entered once (name, phone, message language) and any number of children point at
-- them. A child may have a phone of their own or none; an adult without a parent must have one.
-- Payments, subscriptions and statuses stay per child (D-19): payments and reminder_events do not
-- change. A parent with several children due today gets one WhatsApp message listing them all
-- (D-18); opening it records "chat opened" for every child in it.
--
-- The old model (clients.phone_owner = 'parent' with clients.parent_name) is moved into parents
-- here and then dropped.

-- parents ----------------------------------------------------------------------------------------

create table public.parents (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(btrim(name)) between 1 and 100),
  phone text not null check (phone ~ '^\+77\d{9}$'),
  message_locale text not null default 'ru' check (message_locale in ('ru', 'kk', 'uz')),
  note text not null default '' check (char_length(note) <= 2000),
  archived_at timestamptz,
  created_by uuid not null default auth.uid() references public.staff (id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  search_text text generated always as (public.normalize_search(name || ' ' || phone)) stored
);

comment on table public.parents is
  'A parent who pays for and gets the reminders of their children (clients.parent_id).';
comment on column public.parents.message_locale is
  'Language of the WhatsApp reminders this parent gets: ru, kk or uz (Cyrillic).';

alter table public.parents enable row level security;

create index parents_phone_idx on public.parents (phone);
create index parents_search_text_trgm_idx on public.parents
  using gin (search_text extensions.gin_trgm_ops);

-- keep_client_authorship() only copies created_by and created_at from the old row: it fits here.
create trigger parents_keep_authorship
  before update on public.parents
  for each row execute function public.keep_client_authorship();

create trigger parents_set_updated_at
  before update on public.parents
  for each row execute function public.set_updated_at();

-- As clients: both roles read and write (archiving is an update), only the owner deletes.
create policy parents_select on public.parents
  for select to authenticated
  using ((select public.current_staff_role()) in ('owner', 'admin'));

create policy parents_insert on public.parents
  for insert to authenticated
  with check (
    (select public.current_staff_role()) in ('owner', 'admin')
    and created_by = (select auth.uid())
  );

create policy parents_update on public.parents
  for update to authenticated
  using ((select public.current_staff_role()) in ('owner', 'admin'))
  with check ((select public.current_staff_role()) in ('owner', 'admin'));

create policy parents_delete on public.parents
  for delete to authenticated
  using ((select public.current_staff_role()) = 'owner');

-- A new table gets every privilege for anon and authenticated by default (*_privileges.sql
-- narrowed the tables that existed then). Narrow this one the same way: timestamps and authorship
-- come from the server, TRUNCATE (which skips RLS) is nobody's.
revoke all on public.parents from public, anon, authenticated;
grant select, delete on public.parents to authenticated;
grant insert (id, name, phone, message_locale, note, archived_at, created_by)
  on public.parents to authenticated;
grant update (name, phone, message_locale, note, archived_at) on public.parents to authenticated;

-- clients.parent_id ------------------------------------------------------------------------------

alter table public.clients
  add column parent_id uuid references public.parents (id) on delete restrict;

comment on column public.clients.parent_id is
  'The parent of a child; reminders go to the parent''s phone in the parent''s language.';

create index clients_parent_id_idx on public.clients (parent_id);

grant insert (parent_id) on public.clients to authenticated;
grant update (parent_id) on public.clients to authenticated;

-- A child's own phone is optional; the check below keeps it required for everyone else.
alter table public.clients alter column phone drop not null;

-- The search text survives a missing phone (|| with null would blank the whole text).
alter table public.clients drop column search_text;
alter table public.clients add column search_text text generated always as (
  public.normalize_search(last_name || ' ' || first_name || ' ' || coalesce(phone, ''))
) stored;
comment on column public.clients.search_text is
  'normalize_search(last_name first_name phone); query with normalize_search(input).';
create index clients_search_text_trgm_idx on public.clients
  using gin (search_text extensions.gin_trgm_ops);

-- Moving the old data --------------------------------------------------------------------------

-- Turns old "parent's phone" clients into children of parents. p_links: [{"client_id", "phone",
-- "parent_name"}]. Clients with the same phone and parent name (case and spaces aside) get one
-- parent; the phone moves to the parent. Running it again changes nothing: a linked client is
-- skipped and an existing parent with that phone and name is reused. The parent's language is the
-- one most of its children had, and its author and date are the first child's.
-- Called once below; kept for the tests (tests/integration/families-db.test.ts) and the runbook.
create function public.transfer_legacy_parents(p_links jsonb)
returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  v_parents integer;
  v_children integer;
begin
  create temporary table legacy_links on commit drop as
  select
    l.client_id,
    l.phone,
    btrim(l.parent_name) as parent_name,
    lower(btrim(l.parent_name)) as name_key
  from jsonb_to_recordset(coalesce(p_links, '[]'::jsonb))
    as l (client_id uuid, phone text, parent_name text)
  join public.clients c on c.id = l.client_id
  where c.parent_id is null and c.deleted_at is null and l.phone is not null
    and nullif(btrim(l.parent_name), '') is not null;

  with grouped as (
    select
      l.phone,
      l.name_key,
      (array_agg(l.parent_name order by c.created_at, c.id))[1] as name,
      mode() within group (order by c.message_locale) as message_locale,
      (array_agg(c.created_by order by c.created_at, c.id))[1] as created_by,
      min(c.created_at) as created_at
    from legacy_links l
    join public.clients c on c.id = l.client_id
    group by l.phone, l.name_key
  ),
  inserted as (
    insert into public.parents (name, phone, message_locale, created_by, created_at)
    select g.name, g.phone, g.message_locale, g.created_by, g.created_at
    from grouped g
    where not exists (
      select 1 from public.parents p
      where p.phone = g.phone and lower(btrim(p.name)) = g.name_key
    )
    returning 1
  )
  select count(*)::integer into v_parents from inserted;

  with linked as (
    update public.clients c
    set parent_id = (
          select p.id from public.parents p
          where p.phone = l.phone and lower(btrim(p.name)) = l.name_key
          order by p.created_at, p.id
          limit 1
        ),
        phone = null
    from legacy_links l
    where c.id = l.client_id
    returning 1
  )
  select count(*)::integer into v_children from linked;

  drop table legacy_links;
  return jsonb_build_object('parents', v_parents, 'children', v_children);
end;
$$;

-- Nobody but the migration and the tests (as postgres) runs it.
revoke all on function public.transfer_legacy_parents(jsonb) from public, anon, authenticated;

select public.transfer_legacy_parents((
  select coalesce(
    jsonb_agg(jsonb_build_object('client_id', c.id, 'phone', c.phone, 'parent_name', c.parent_name)),
    '[]'::jsonb
  )
  from public.clients c
  where c.phone_owner = 'parent'
));

alter table public.clients drop constraint clients_parent_name_required;
alter table public.clients drop column phone_owner;
alter table public.clients drop column parent_name;

alter table public.clients
  add constraint clients_phone_or_parent check (parent_id is not null or phone is not null);

-- Templates: one message for several children ----------------------------------------------------

-- "family" is not a reminder kind (events keep before_7 / before_1 / overdue per child): it is the
-- text used when one parent has several children to remind today.
alter table public.message_templates drop constraint message_templates_kind_check;
alter table public.message_templates add constraint message_templates_kind_check
  check (kind in ('before_7', 'before_1', 'overdue', 'family'));

-- STUB(D-22): draft texts in all three languages until the customer reads them; the settings
-- screen marks them "draft" while nobody has edited them (updated_by is null). {дети} becomes one
-- line per child: "Арман: до 16 декабря, 15 000 ₸" (familyLine() in template.ts).
insert into public.message_templates (name, kind, locale, body) values
  (
    'Несколько детей',
    'family',
    'ru',
    E'Здравствуйте, {имя}! {название_зала}: напоминаем об абонементах ваших детей.\n{дети}\nПродлить можно у администратора.'
  ),
  (
    'Несколько детей (kk)',
    'family',
    'kk',
    E'Сәлеметсіз бе, {имя}! {название_зала}: балаларыңыздың абонементтері туралы еске саламыз.\n{дети}\nӘкімшіде ұзартуға болады.'
  ),
  (
    'Несколько детей (uz)',
    'family',
    'uz',
    E'Ассалому алайкум, {имя}! {название_зала}: фарзандларингиз абонементлари ҳақида эслатамиз.\n{дети}\nАдминистраторда узайтириш мумкин.'
  );

-- Who a reminder goes to -------------------------------------------------------------------------

-- STUB(D-20): a child with a parent is reminded through the parent only, also when the child has a
-- phone of their own (the parent pays). Waits for the customer's confirmation.
-- The reminder fields of one client: the phone, name and language of whoever gets the message.
drop function public.reminder_settings_screen(date);
drop function public.reminders_screen(text, date, date, uuid, integer);
drop function public.reminder_contact_json(public.clients, text, integer, uuid, text, date);

create function public.reminder_contact_json(
  p_client public.clients,
  p_parent public.parents,
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
    'phone', coalesce(p_parent.phone, p_client.phone),
    'parent_id', p_parent.id,
    'parent_name', p_parent.name,
    'message_locale', coalesce(p_parent.message_locale, p_client.message_locale),
    'group_name', p_group_name,
    'price', p_price,
    'payment_id', p_payment_id,
    'kind', p_kind,
    'ends_on', p_ends_on
  );
$$;

-- As in *_send_language.sql; without a chosen language a child's reminder is in the parent's.
create or replace function public.reminder_template_for(
  p_client_id uuid,
  p_kind text,
  p_locale text default null
)
returns uuid
language sql
stable
set search_path = ''
as $$
  with wanted as (
    select coalesce(p_locale, p.message_locale, c.message_locale) as locale
    from public.clients c
    left join public.parents p on p.id = c.parent_id
    where c.id = p_client_id
  )
  select t.id
  from public.message_templates t
  cross join wanted w
  where t.kind = p_kind and t.locale in (w.locale, 'ru')
  order by t.locale = w.locale desc
  limit 1;
$$;

-- One message for several children of a parent: records "chat opened" for every child in it, each
-- with its own subscription and kind, all referencing the family template in p_locale (or the
-- parent's language; Russian when that one has none). p_items: [{"payment_id", "kind"}], 2..20.
-- Every payment must belong to a current child of p_parent_id. A repeat keeps the first events:
-- reminder_events (payment_id, kind) is unique, so nothing is doubled.
create function public.record_family_reminder_opened(
  p_parent_id uuid,
  p_items jsonb,
  p_locale text default null
)
returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  v_parent public.parents;
  v_template_id uuid;
  v_item record;
  v_client_id uuid;
  v_event public.reminder_events;
  v_created boolean;
  v_results jsonb := '[]'::jsonb;
begin
  perform public.require_staff_role(array['owner', 'admin']);
  if p_items is null or jsonb_typeof(p_items) <> 'array'
     or jsonb_array_length(p_items) not between 2 and 20 then
    raise exception 'invalid_items' using errcode = '22023';
  end if;
  if p_locale is not null and p_locale not in ('ru', 'kk', 'uz') then
    raise exception 'invalid_locale' using errcode = '22023';
  end if;

  select * into v_parent from public.parents p where p.id = p_parent_id;
  if not found then
    raise exception 'parent_not_found' using errcode = 'P0002';
  end if;

  select t.id into v_template_id
  from public.message_templates t
  where t.kind = 'family' and t.locale in (coalesce(p_locale, v_parent.message_locale), 'ru')
  order by t.locale = coalesce(p_locale, v_parent.message_locale) desc
  limit 1;
  if v_template_id is null then
    raise exception 'template_not_found' using errcode = 'P0002';
  end if;

  for v_item in
    select * from jsonb_to_recordset(p_items) as i (payment_id uuid, kind text)
  loop
    if v_item.kind is null or v_item.kind not in ('before_7', 'before_1', 'overdue') then
      raise exception 'invalid_kind' using errcode = '22023';
    end if;

    select p.client_id into v_client_id
    from public.payments p
    join public.clients c on c.id = p.client_id
    where p.id = v_item.payment_id
      and p.kind in ('payment', 'import_balance')
      and c.parent_id = p_parent_id
      and c.deleted_at is null;
    if not found then
      raise exception 'payment_not_found' using errcode = 'P0002';
    end if;

    v_created := true;
    insert into public.reminder_events (client_id, payment_id, kind, template_id, opened_by)
    values (v_client_id, v_item.payment_id, v_item.kind, v_template_id, (select auth.uid()))
    on conflict (payment_id, kind) do nothing
    returning * into v_event;

    if not found then
      v_created := false;
      select * into v_event
      from public.reminder_events re
      where re.payment_id = v_item.payment_id and re.kind = v_item.kind;
    end if;

    v_results := v_results || jsonb_build_object(
      'id', v_event.id,
      'client_id', v_event.client_id,
      'payment_id', v_event.payment_id,
      'opened_at', v_event.opened_at,
      'status', v_event.status,
      'created', v_created
    );
  end loop;

  return v_results;
end;
$$;

-- Screens ----------------------------------------------------------------------------------------

-- As in *_reminders.sql; reminder_contact_json() now also takes the parent.
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
          public.reminder_contact_json(c, pa, g.name, g.default_price, r.payment_id, r.kind, r.ends_on)
          order by r.ends_on, lower(c.last_name), lower(c.first_name), c.id
        )
        from public.reminders_due(p_today) r
        join public.clients c on c.id = r.client_id
        left join public.parents pa on pa.id = c.parent_id
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
              c, pa, g.name, g.default_price, cs.payment_id, 'overdue', cs.ends_on
            ) || jsonb_build_object(
              'event',
              case when e.id is null then null
                   else public.reminder_event_json(e, ob.full_name, mb.full_name) end
            ) as row_json
          from public.client_status(p_today) cs
          join public.clients c on c.id = cs.client_id
          left join public.parents pa on pa.id = c.parent_id
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

-- As in *_reminders.sql; reminder_contact_json() now also takes the parent.
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
      select public.reminder_contact_json(
        c, pa, g.name, g.default_price, cs.payment_id, null, cs.ends_on
      )
      from public.clients c
      join public.client_status(p_today) cs on cs.client_id = c.id
      join public.groups g on g.id = c.group_id and g.archived_at is null
      left join public.parents pa on pa.id = c.parent_id
      where c.archived_at is null and cs.payment_id is not null
      order by lower(c.last_name), lower(c.first_name), c.id
      limit 1
    )
  );
$$;

-- The Today screen as in *_message_languages.sql. A "remind" row now carries whoever gets the
-- message (the parent for a child) and the parent's id, so the screen can put the children of one
-- parent into one message (D-18).
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
      coalesce(pa.phone, c.phone) as phone,
      pa.id as parent_id,
      pa.name as parent_name,
      coalesce(pa.message_locale, c.message_locale) as message_locale,
      g.name as group_name,
      g.default_price as price,
      cs.ends_on,
      d.payment_id as remind_payment_id,
      d.kind as remind_kind,
      d.client_id is not null as remind,
      c.id in (select client_id from paid) as paid
    from public.clients c
    join public.client_status(p_today) cs on cs.client_id = c.id
    left join public.parents pa on pa.id = c.parent_id
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
            'parent_id', r.parent_id,
            'parent_name', r.parent_name,
            'message_locale', r.message_locale
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

-- The /clients screen as in *_payments_management.sql; a child also carries the parent's name and
-- phone, so searching by them finds the child (the list is searched in the browser).
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
    select
      c.id, c.last_name, c.first_name, c.phone, c.group_id, c.archived_at, cs.status, cs.ends_on,
      pa.name as parent_name, pa.phone as parent_phone
    from public.clients c
    join public.client_status(p_today) cs on cs.client_id = c.id
    left join public.parents pa on pa.id = c.parent_id
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
          'parent_name', l.parent_name,
          'parent_phone', l.parent_phone,
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

-- The client card as in *_message_languages.sql. The parent replaces phone_owner / parent_name;
-- the card's reminder goes to the parent in the parent's language.
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
      'message_locale', c.message_locale,
      'group_id', c.group_id,
      'started_on', c.started_on,
      'note', c.note,
      'archived', c.archived_at is not null
    ),
    'parent', case when pa.id is null then null else jsonb_build_object(
      'id', pa.id,
      'name', pa.name,
      'phone', pa.phone,
      'message_locale', pa.message_locale,
      'archived', pa.archived_at is not null
    ) end,
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
    'reminder', case when cs.payment_id is null then null else jsonb_build_object(
      'payment_id', cs.payment_id,
      'kind', case
        when cs.status = 'expired' then 'overdue'
        else coalesce(
          public.reminder_kind_for(
            cs.days_left, (select st.reminder_days from public.settings st limit 1)
          ),
          'before_7'
        )
      end
    ) end,
    'reminder_context', public.reminder_context(),
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
  left join public.parents pa on pa.id = c.parent_id
  left join public.groups g on g.id = c.group_id
  left join public.staff s on s.id = g.coach_id
  where c.id = p_client_id
    and c.deleted_at is null;
$$;

-- The /parents/[id] card: the parent and their children with status, current subscription and
-- group price (for "Paid" per child, D-19). Null when there is no such parent.
create function public.parent_screen(
  p_parent_id uuid,
  p_today date default (now() at time zone 'Asia/Almaty')::date
)
returns jsonb
language sql
stable
set search_path = ''
as $$
  select jsonb_build_object(
    'parent', jsonb_build_object(
      'id', pa.id,
      'name', pa.name,
      'phone', pa.phone,
      'message_locale', pa.message_locale,
      'note', pa.note,
      'archived', pa.archived_at is not null
    ),
    'children', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'id', c.id,
          'last_name', c.last_name,
          'first_name', c.first_name,
          'archived', c.archived_at is not null,
          'status', cs.status,
          'ends_on', cs.ends_on,
          'group_name', case when g.archived_at is null then g.name end,
          'price', case when g.archived_at is null then g.default_price end
        )
        order by c.archived_at is not null, lower(c.first_name), lower(c.last_name), c.id
      )
      from public.clients c
      join public.client_status(p_today) cs on cs.client_id = c.id
      left join public.groups g on g.id = c.group_id
      where c.parent_id = pa.id and c.deleted_at is null
    ), '[]'::jsonb)
  )
  from public.parents pa
  where pa.id = p_parent_id;
$$;

comment on function public.parent_screen(uuid, date) is
  'A parent''s card in one call: the parent and their children with status; null when none.';

-- Parents for the picker on the client form: by name or phone (both normalised like the search
-- text), current ones only, with their children's first names to tell namesakes apart.
create function public.search_parents(p_query text, p_limit integer default 10)
returns jsonb
language sql
stable
set search_path = ''
as $$
  with found as (
    select pa.id, pa.name, pa.phone, pa.message_locale
    from public.parents pa
    where pa.archived_at is null
      and char_length(btrim(coalesce(p_query, ''))) between 2 and 100
      and (
        pa.search_text like '%' || public.normalize_search(p_query) || '%'
        or (
          regexp_replace(p_query, '\D', '', 'g') <> ''
          and char_length(regexp_replace(p_query, '\D', '', 'g')) >= 3
          and pa.phone like '%' || regexp_replace(p_query, '\D', '', 'g') || '%'
        )
      )
    order by lower(pa.name), pa.id
    limit greatest(least(coalesce(p_limit, 10), 20), 0)
  )
  select coalesce(jsonb_agg(
    jsonb_build_object(
      'id', f.id,
      'name', f.name,
      'phone', f.phone,
      'message_locale', f.message_locale,
      'children', coalesce((
        select jsonb_agg(c.first_name order by lower(c.first_name), c.id)
        from public.clients c
        where c.parent_id = f.id and c.deleted_at is null
      ), '[]'::jsonb)
    )
    order by lower(f.name), f.id
  ), '[]'::jsonb)
  from found f;
$$;

-- Client writes ----------------------------------------------------------------------------------

-- The parent of a client being saved: an existing current one (p_parent_id), a new one created
-- here (p_new_parent: {"name", "phone", "message_locale"}), or none. A new parent gets its own
-- audit row (ids only).
create function public.resolve_client_parent(p_parent_id uuid, p_new_parent jsonb)
returns uuid
language plpgsql
set search_path = ''
as $$
declare
  v_id uuid;
begin
  if p_parent_id is not null and p_new_parent is not null then
    raise exception 'invalid_parent' using errcode = '22023';
  end if;
  if p_new_parent is not null then
    if jsonb_typeof(p_new_parent) <> 'object' then
      raise exception 'invalid_parent' using errcode = '22023';
    end if;
    insert into public.parents (name, phone, message_locale, created_by)
    values (
      btrim(p_new_parent ->> 'name'),
      p_new_parent ->> 'phone',
      coalesce(p_new_parent ->> 'message_locale', 'ru'),
      (select auth.uid())
    )
    returning id into v_id;
    insert into public.audit_log (actor_id, action, entity, entity_id)
    values ((select auth.uid()), 'parent.create', 'parent', v_id);
    return v_id;
  end if;
  if p_parent_id is not null and not exists (
    select 1 from public.parents p where p.id = p_parent_id and p.archived_at is null
  ) then
    raise exception 'parent_not_found' using errcode = 'P0002';
  end if;
  return p_parent_id;
end;
$$;

-- As in *_message_languages.sql, with a parent instead of phone_owner / parent_name. A new argument
-- list changes the signature, so the old functions are dropped rather than overloaded.
drop function public.create_client(text, text, text, text, date, date, text, uuid, text, text[], text);
drop function public.update_client(
  uuid, text, text, text, text, date, date, text, uuid, text, text[], text
);

create function public.create_client(
  p_last_name text,
  p_first_name text,
  p_started_on date,
  p_phone text default null,
  p_birth_date date default null,
  p_parent_id uuid default null,
  p_new_parent jsonb default null,
  p_group_id uuid default null,
  p_note text default '',
  p_consents text[] default '{}',
  p_message_locale text default 'ru'
)
returns uuid
language plpgsql
set search_path = ''
as $$
declare
  v_id uuid;
  v_parent_id uuid;
  v_consents text[];
begin
  perform public.require_staff_role(array['owner', 'admin']);
  perform public.check_client_group(p_group_id);
  v_parent_id := public.resolve_client_parent(p_parent_id, p_new_parent);

  -- An adult without a phone is stopped by clients_phone_or_parent (23514).
  insert into public.clients (
    last_name, first_name, birth_date, phone, parent_id, group_id, started_on, note,
    message_locale, created_by
  ) values (
    btrim(p_last_name),
    btrim(p_first_name),
    p_birth_date,
    p_phone,
    v_parent_id,
    p_group_id,
    p_started_on,
    coalesce(p_note, ''),
    coalesce(p_message_locale, 'ru'),
    (select auth.uid())
  )
  returning id into v_id;

  v_consents := public.add_client_consents(v_id, p_consents);

  -- Ids and consent kinds only: the audit log never holds names or phones.
  insert into public.audit_log (actor_id, action, entity, entity_id, details)
  values (
    (select auth.uid()), 'client.create', 'client', v_id,
    jsonb_build_object(
      'group_id', p_group_id, 'parent_id', v_parent_id, 'consents', to_jsonb(v_consents)
    )
  );
  return v_id;
end;
$$;

-- p_message_locale null keeps the language on file.
create function public.update_client(
  p_client_id uuid,
  p_last_name text,
  p_first_name text,
  p_started_on date,
  p_phone text default null,
  p_birth_date date default null,
  p_parent_id uuid default null,
  p_new_parent jsonb default null,
  p_group_id uuid default null,
  p_note text default '',
  p_consents text[] default '{}',
  p_message_locale text default null
)
returns void
language plpgsql
set search_path = ''
as $$
declare
  v_old public.clients;
  v_new public.clients;
  v_parent_id uuid;
  v_fields text[] := '{}';
  v_consents text[];
begin
  perform public.require_staff_role(array['owner', 'admin']);
  select * into v_old from public.clients c where c.id = p_client_id for update;
  if not found or v_old.deleted_at is not null then
    raise exception 'client_not_found' using errcode = 'P0002';
  end if;
  perform public.check_client_group(p_group_id, v_old.group_id);
  -- A child may stay with a parent that was archived meanwhile, as with groups.
  if p_parent_id is not null and p_parent_id is not distinct from v_old.parent_id then
    v_parent_id := p_parent_id;
  else
    v_parent_id := public.resolve_client_parent(p_parent_id, p_new_parent);
  end if;

  update public.clients
  set last_name = btrim(p_last_name),
      first_name = btrim(p_first_name),
      birth_date = p_birth_date,
      phone = p_phone,
      parent_id = v_parent_id,
      group_id = p_group_id,
      started_on = p_started_on,
      note = coalesce(p_note, ''),
      message_locale = coalesce(p_message_locale, message_locale)
  where id = p_client_id
  returning * into v_new;

  -- Field names only: the audit log never holds the values.
  if v_old.last_name is distinct from v_new.last_name then
    v_fields := array_append(v_fields, 'last_name');
  end if;
  if v_old.first_name is distinct from v_new.first_name then
    v_fields := array_append(v_fields, 'first_name');
  end if;
  if v_old.birth_date is distinct from v_new.birth_date then
    v_fields := array_append(v_fields, 'birth_date');
  end if;
  if v_old.phone is distinct from v_new.phone then
    v_fields := array_append(v_fields, 'phone');
  end if;
  if v_old.parent_id is distinct from v_new.parent_id then
    v_fields := array_append(v_fields, 'parent_id');
  end if;
  if v_old.group_id is distinct from v_new.group_id then
    v_fields := array_append(v_fields, 'group_id');
  end if;
  if v_old.started_on is distinct from v_new.started_on then
    v_fields := array_append(v_fields, 'started_on');
  end if;
  if v_old.note is distinct from v_new.note then
    v_fields := array_append(v_fields, 'note');
  end if;
  if v_old.message_locale is distinct from v_new.message_locale then
    v_fields := array_append(v_fields, 'message_locale');
  end if;

  v_consents := public.add_client_consents(p_client_id, p_consents);

  if cardinality(v_fields) > 0 or cardinality(v_consents) > 0 then
    insert into public.audit_log (actor_id, action, entity, entity_id, details)
    values (
      (select auth.uid()), 'client.update', 'client', p_client_id,
      jsonb_build_object(
        'fields', to_jsonb(v_fields),
        'consents', to_jsonb(v_consents),
        'from_group_id', case when 'group_id' = any (v_fields) then v_old.group_id end,
        'to_group_id', case when 'group_id' = any (v_fields) then v_new.group_id end,
        'from_parent_id', case when 'parent_id' = any (v_fields) then v_old.parent_id end,
        'to_parent_id', case when 'parent_id' = any (v_fields) then v_new.parent_id end
      )
    );
  end if;
end;
$$;

-- Parent writes ----------------------------------------------------------------------------------

-- Name, phone, language and note of a parent. Field names only go to the audit log.
create function public.update_parent(
  p_parent_id uuid,
  p_name text,
  p_phone text,
  p_message_locale text,
  p_note text default ''
)
returns void
language plpgsql
set search_path = ''
as $$
declare
  v_old public.parents;
  v_new public.parents;
  v_fields text[] := '{}';
begin
  perform public.require_staff_role(array['owner', 'admin']);
  select * into v_old from public.parents p where p.id = p_parent_id for update;
  if not found then
    raise exception 'parent_not_found' using errcode = 'P0002';
  end if;

  update public.parents
  set name = btrim(p_name),
      phone = p_phone,
      message_locale = p_message_locale,
      note = coalesce(p_note, '')
  where id = p_parent_id
  returning * into v_new;

  -- "parent_name", not "name": the audit screen labels "name" as a group's name.
  if v_old.name is distinct from v_new.name then
    v_fields := array_append(v_fields, 'parent_name');
  end if;
  if v_old.phone is distinct from v_new.phone then
    v_fields := array_append(v_fields, 'phone');
  end if;
  if v_old.message_locale is distinct from v_new.message_locale then
    v_fields := array_append(v_fields, 'message_locale');
  end if;
  if v_old.note is distinct from v_new.note then
    v_fields := array_append(v_fields, 'note');
  end if;

  if cardinality(v_fields) > 0 then
    insert into public.audit_log (actor_id, action, entity, entity_id, details)
    values (
      (select auth.uid()), 'parent.update', 'parent', p_parent_id,
      jsonb_build_object('fields', to_jsonb(v_fields))
    );
  end if;
end;
$$;

-- As in *_clients_management.sql; a blanked client also loses the link to the parent.
create or replace function public.delete_client(p_client_id uuid, p_reason text, p_last_name text)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_client public.clients;
  v_mode text;
begin
  perform public.require_staff_role(array['owner']);
  if p_reason is null
     or p_reason not in ('duplicate', 'created_by_mistake', 'client_request', 'other') then
    raise exception 'invalid_reason' using errcode = '22023';
  end if;

  select * into v_client from public.clients c where c.id = p_client_id for update;
  if not found or v_client.deleted_at is not null then
    raise exception 'client_not_found' using errcode = 'P0002';
  end if;
  if lower(btrim(coalesce(p_last_name, ''))) <> lower(btrim(v_client.last_name)) then
    raise exception 'confirmation_mismatch' using errcode = '22023';
  end if;

  if exists (select 1 from public.payments p where p.client_id = p_client_id)
     or exists (select 1 from public.consents k where k.client_id = p_client_id)
     or exists (select 1 from public.reminder_events r where r.client_id = p_client_id) then
    v_mode := 'anonymized';
    update public.clients
    set last_name = '—',
        first_name = '—',
        birth_date = null,
        phone = '+77000000000',
        parent_id = null,
        group_id = null,
        note = '',
        archived_at = coalesce(archived_at, now()),
        deleted_at = now()
    where id = p_client_id;
  else
    v_mode := 'deleted';
    delete from public.clients where id = p_client_id;
  end if;

  insert into public.audit_log (actor_id, action, entity, entity_id, details)
  values (
    (select auth.uid()), 'client.delete', 'client', p_client_id,
    jsonb_build_object('mode', v_mode, 'reason', p_reason)
  );
  return v_mode;
end;
$$;

-- Export -----------------------------------------------------------------------------------------

-- As in *_reports.sql, with the parent's name and phone instead of phone_owner / parent_name.
create or replace function public.export_clients(
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
      'parent_name', pa.name,
      'parent_phone', pa.phone,
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
  left join public.parents pa on pa.id = c.parent_id
  left join public.groups g on g.id = c.group_id
  where c.deleted_at is null;

  perform public.begin_export(
    'client', p_format, jsonb_build_object('rows', jsonb_array_length(v_rows))
  );
  return v_rows;
end;
$$;

-- Import -----------------------------------------------------------------------------------------

-- As in *_client_import.sql. A child is on file under the parent's phone, so "existing" matches the
-- client's own phone or the parent's; "parents" lists the parents with these phones, so the
-- preview can say "parent: found" or "parent: new".
create or replace function public.import_context(p_phones text[], p_file_hash text)
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
        jsonb_build_object(
          'phone', coalesce(c.phone, pa.phone),
          'last_name', c.last_name,
          'first_name', c.first_name
        )
      )
      from public.clients c
      left join public.parents pa on pa.id = c.parent_id
      where (c.phone = any (coalesce(p_phones, '{}')) or pa.phone = any (coalesce(p_phones, '{}')))
        and c.deleted_at is null
    ), '[]'::jsonb),
    'parents', coalesce((
      select jsonb_agg(jsonb_build_object('phone', pa.phone, 'name', pa.name))
      from public.parents pa
      where pa.phone = any (coalesce(p_phones, '{}')) and pa.archived_at is null
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

-- As in *_message_languages.sql. A row may carry parent_name (the "Родитель" column): the row is a
-- child of that parent, the phone is the parent's. Rows with the same phone and parent name (case
-- and spaces aside) share one parent; an existing current parent with that phone and name is
-- reused, otherwise one is created in the row's language. Duplicates are matched on the client's
-- own phone or the parent's.
create or replace function public.import_clients(
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
  v_parent_id uuid;
  v_parent_key text;
  v_parent_ids jsonb := '{}'::jsonb;
  v_created integer := 0;
  v_duplicates integer := 0;
  v_parents_created integer := 0;
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
      ends_on date,
      message_locale text,
      parent_name text
    )
    order by r.line
  loop
    if exists (
      select 1 from public.clients c
      left join public.parents pa on pa.id = c.parent_id
      where coalesce(c.phone, pa.phone) = v_row.phone
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

    v_parent_id := null;
    if nullif(btrim(v_row.parent_name), '') is not null then
      v_parent_key := v_row.phone || '|' || lower(btrim(v_row.parent_name));
      v_parent_id := (v_parent_ids ->> v_parent_key)::uuid;
      if v_parent_id is null then
        select pa.id into v_parent_id
        from public.parents pa
        where pa.phone = v_row.phone
          and lower(btrim(pa.name)) = lower(btrim(v_row.parent_name))
          and pa.archived_at is null
        order by pa.created_at, pa.id
        limit 1;
      end if;
      if v_parent_id is null then
        insert into public.parents (name, phone, message_locale, created_by)
        values (
          btrim(v_row.parent_name), v_row.phone, coalesce(v_row.message_locale, 'ru'), v_actor
        )
        returning id into v_parent_id;
        v_parents_created := v_parents_created + 1;
      end if;
      v_parent_ids := v_parent_ids || jsonb_build_object(v_parent_key, v_parent_id);
    end if;

    insert into public.clients (
      last_name, first_name, phone, parent_id, group_id, started_on, message_locale, created_by
    ) values (
      btrim(v_row.last_name), btrim(v_row.first_name),
      case when v_parent_id is null then v_row.phone end, v_parent_id, v_group_id, p_today,
      coalesce(v_row.message_locale, 'ru'), v_actor
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
      'parents_created', v_parents_created,
      'groups_created', to_jsonb(v_created_groups)
    )
  );

  return jsonb_build_object(
    'created', v_created,
    'duplicates', v_duplicates,
    'parents_created', v_parents_created,
    'groups_created', cardinality(v_created_groups)
  );
end;
$$;

-- Audit log --------------------------------------------------------------------------------------

-- A new parent (with a child, or by the import) and a changed parent. As in *_staff_passwords.sql
-- plus these two; src/features/audit/actions.ts keeps the same list.
alter table public.audit_log drop constraint audit_log_action_known;
alter table public.audit_log
  add constraint audit_log_action_known check (
    action in (
      'staff.login',
      'staff.password_change',
      'staff.password_reset',
      'staff.invite',
      'staff.role_change',
      'staff.deactivate',
      'staff.activate',
      'client.create',
      'client.update',
      'client.archive',
      'client.restore',
      'client.delete',
      'client.move',
      'client.import',
      'parent.create',
      'parent.update',
      'group.create',
      'group.update',
      'group.archive',
      'payment.create',
      'payment.cancel',
      'payment.reverse',
      'settings.update',
      'template.update',
      'report.export'
    )
  );

-- As in *_audit_settings_staff.sql, plus the parent's name for a parent entry (a link to the
-- parent's card on the audit screen).
create or replace function public.audit_feed(
  p_actor uuid default null,
  p_action text default null,
  p_from date default null,
  p_to date default null,
  p_before_at timestamptz default null,
  p_before_id uuid default null,
  p_limit integer default 50
)
returns jsonb
language plpgsql
stable
set search_path = ''
as $$
declare
  v_limit integer := least(greatest(coalesce(p_limit, 50), 1), 100);
  v_entries jsonb;
  v_staff jsonb;
begin
  perform public.require_staff_role(array['owner']);
  if (p_before_at is null) <> (p_before_id is null) then
    raise exception 'invalid_cursor' using errcode = '22023';
  end if;

  with page as (
    select a.*
    from public.audit_log a
    where (p_actor is null or a.actor_id = p_actor)
      and (p_action is null or a.action = p_action)
      and (p_from is null or a.created_at >= (p_from::timestamp at time zone 'Asia/Almaty'))
      and (p_to is null or a.created_at < ((p_to + 1)::timestamp at time zone 'Asia/Almaty'))
      and (p_before_at is null or (a.created_at, a.id) < (p_before_at, p_before_id))
    order by a.created_at desc, a.id desc
    -- One extra row tells whether there is a next page.
    limit v_limit + 1
  )
  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'id', p.id,
        'created_at', p.created_at,
        'actor_id', p.actor_id,
        'actor_name', actor.full_name,
        'action', p.action,
        'entity', p.entity,
        'entity_id', p.entity_id,
        'details', p.details,
        'client_id', client.id,
        'client_name', case
          when client.deleted_at is null then client.last_name || ' ' || client.first_name
        end,
        'group_name', grp.name,
        'staff_name', staff.full_name,
        'parent_name', parent.name
      )
      order by p.created_at desc, p.id desc
    ),
    '[]'::jsonb
  )
  into v_entries
  from page p
  left join public.staff actor on actor.id = p.actor_id
  left join public.clients client on client.id = case
    when p.entity = 'client' then p.entity_id
    when p.details ? 'client_id' then (p.details ->> 'client_id')::uuid
  end
  left join public.groups grp on p.entity = 'group' and grp.id = p.entity_id
  left join public.staff staff on p.entity = 'staff' and staff.id = p.entity_id
  left join public.parents parent on p.entity = 'parent' and parent.id = p.entity_id;

  select coalesce(
    jsonb_agg(jsonb_build_object('id', s.id, 'name', s.full_name) order by s.full_name),
    '[]'::jsonb
  )
  into v_staff
  from public.staff s;

  return jsonb_build_object('entries', v_entries, 'staff', v_staff, 'limit', v_limit);
end;
$$;

-- Grants -----------------------------------------------------------------------------------------

grant execute on function public.reminder_contact_json(
  public.clients, public.parents, text, integer, uuid, text, date
) to authenticated, service_role;
grant execute on function public.record_family_reminder_opened(uuid, jsonb, text)
  to authenticated, service_role;
grant execute on function public.reminders_screen(text, date, date, uuid, integer)
  to authenticated, service_role;
grant execute on function public.reminder_settings_screen(date) to authenticated, service_role;
grant execute on function public.parent_screen(uuid, date) to authenticated, service_role;
grant execute on function public.search_parents(text, integer) to authenticated, service_role;
grant execute on function public.resolve_client_parent(uuid, jsonb) to authenticated, service_role;
grant execute on function public.create_client(
  text, text, date, text, date, uuid, jsonb, uuid, text, text[], text
) to authenticated, service_role;
grant execute on function public.update_client(
  uuid, text, text, date, text, date, uuid, jsonb, uuid, text, text[], text
) to authenticated, service_role;
grant execute on function public.update_parent(uuid, text, text, text, text)
  to authenticated, service_role;
