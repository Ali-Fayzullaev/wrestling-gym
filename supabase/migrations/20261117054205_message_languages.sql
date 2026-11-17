-- Reminders in the client's language (step 19, D-13).
--
-- Every client has a message language: Russian, Kazakh or Uzbek (Cyrillic). Each reminder kind has
-- a template per language; a reminder takes the template of its kind in the client's language, or
-- the Russian one when that language has none. The interface language of an employee (staff.locale)
-- has nothing to do with it: an admin reading Russian sends a Kazakh client a Kazakh text.

-- Clients ----------------------------------------------------------------------------------------

alter table public.clients
  add column message_locale text not null default 'ru'
    constraint clients_message_locale_check check (message_locale in ('ru', 'kk', 'uz'));

comment on column public.clients.message_locale is
  'Language of the reminders this client gets in WhatsApp: ru, kk or uz (Cyrillic).';

-- Both roles edit clients, and so the language (create_client / update_client run as the caller).
grant insert (message_locale) on public.clients to authenticated;
grant update (message_locale) on public.clients to authenticated;

-- Templates --------------------------------------------------------------------------------------

alter table public.message_templates
  add column locale text not null default 'ru'
    constraint message_templates_locale_check check (locale in ('ru', 'kk', 'uz'));

comment on column public.message_templates.locale is
  'Language of the text; one template per (kind, locale).';

-- The existing three are the Russian ones. Kind and language together pick the text now.
alter table public.message_templates drop constraint message_templates_kind_unique;
alter table public.message_templates
  add constraint message_templates_kind_locale_unique unique (kind, locale);

-- Nobody moves a template to another language: the column is not granted for update (like kind),
-- and nobody may insert (step 09). The owner edits texts only.
revoke update (locale) on public.message_templates from authenticated;

-- STUB(D-13): draft translations until a native speaker reads them; the settings screen marks a
-- Kazakh or Uzbek template "draft" while nobody has edited it (updated_by is null).
insert into public.message_templates (name, kind, locale, body) values
  (
    'За 7 дней (kk)',
    'before_7',
    'kk',
    'Сәлеметсіз бе, {имя}! {название_зала}: абонементіңіз {дата_окончания} аяқталады. Ұзарту сомасы: {сумма} теңге.'
  ),
  (
    'За 1 день (kk)',
    'before_1',
    'kk',
    'Сәлеметсіз бе, {имя}! Еске саламыз: {название_зала}, абонементіңіз ертең, {дата_окончания}, аяқталады. Ұзарту сомасы: {сумма} теңге.'
  ),
  (
    'В день окончания (kk)',
    'overdue',
    'kk',
    'Сәлеметсіз бе, {имя}! {название_зала}: абонементіңіз {дата_окончания} аяқталды. Әкімшіде ұзартуға болады, сомасы: {сумма} теңге.'
  ),
  (
    'За 7 дней (uz)',
    'before_7',
    'uz',
    'Ассалому алайкум, {имя}! {название_зала}: абонементингиз {дата_окончания} куни тугайди. Узайтириш суммаси: {сумма} тенге.'
  ),
  (
    'За 1 день (uz)',
    'before_1',
    'uz',
    'Ассалому алайкум, {имя}! Эслатамиз: {название_зала}, абонементингиз эртага, {дата_окончания} куни тугайди. Узайтириш суммаси: {сумма} тенге.'
  ),
  (
    'В день окончания (uz)',
    'overdue',
    'uz',
    'Ассалому алайкум, {имя}! {название_зала}: абонементингиз {дата_окончания} куни тугади. Администраторда узайтириш мумкин, суммаси: {сумма} тенге.'
  );

-- What a wa.me text is built from ------------------------------------------------------------------

-- Templates of every language: the server picks one per client (pickTemplate() in
-- src/features/reminders/template.ts, the same rule as record_reminder_opened() below).
create or replace function public.reminder_context()
returns jsonb
language sql
stable
set search_path = ''
as $$
  select jsonb_build_object(
    'gym_name', (select s.gym_name from public.settings s limit 1),
    'reminder_days', (select to_jsonb(s.reminder_days) from public.settings s limit 1),
    'templates', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'id', t.id,
          'kind', t.kind,
          'locale', t.locale,
          'body', t.body,
          'edited', t.updated_by is not null
        )
        order by t.kind, t.locale
      )
      from public.message_templates t
    ), '[]'::jsonb)
  );
$$;

create or replace function public.reminder_contact_json(
  p_client public.clients,
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
    'phone', p_client.phone,
    'phone_owner', p_client.phone_owner,
    'parent_name', p_client.parent_name,
    'message_locale', p_client.message_locale,
    'group_name', p_group_name,
    'price', p_price,
    'payment_id', p_payment_id,
    'kind', p_kind,
    'ends_on', p_ends_on
  );
$$;

-- The template of this kind in the client's language, or the Russian one. Shared by the record of
-- an opened chat; the screens apply the same rule to the templates reminder_context() returns.
create function public.reminder_template_for(p_client_id uuid, p_kind text)
returns uuid
language sql
stable
set search_path = ''
as $$
  select t.id
  from public.message_templates t
  join public.clients c on c.id = p_client_id
  where t.kind = p_kind and t.locale in (c.message_locale, 'ru')
  order by t.locale = c.message_locale desc
  limit 1;
$$;

comment on function public.reminder_template_for(uuid, text) is
  'Template of p_kind in the client''s message language, falling back to Russian.';

-- As in *_client_import.sql; the event now references the template in the client's language.
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

  v_template_id := public.reminder_template_for(v_client_id, p_kind);
  if v_template_id is null then
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

-- As in *_reminders.sql; the audit row also names the template's language.
create or replace function public.update_reminder_settings(p_reminder_days integer[], p_templates jsonb)
returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  v_old_days integer[];
  v_days_changed boolean := false;
  v_templates_changed integer := 0;
  v_item jsonb;
  v_template public.message_templates;
  v_body text;
begin
  perform public.require_staff_role(array['owner']);
  if p_reminder_days is null or jsonb_typeof(p_templates) is distinct from 'array' then
    raise exception 'invalid_settings' using errcode = '22023';
  end if;

  select s.reminder_days into v_old_days from public.settings s where s.id for update;
  if v_old_days is distinct from p_reminder_days then
    -- settings.reminder_days has the range and distinctness checks (23514 on a bad value).
    update public.settings set reminder_days = p_reminder_days where id;
    insert into public.audit_log (actor_id, action, entity, entity_id, details)
    values (
      (select auth.uid()), 'settings.update', 'settings', null,
      jsonb_build_object(
        'fields', jsonb_build_array('reminder_days'),
        'from', to_jsonb(v_old_days),
        'to', to_jsonb(p_reminder_days)
      )
    );
    v_days_changed := true;
  end if;

  for v_item in select value from jsonb_array_elements(p_templates) loop
    if jsonb_typeof(v_item -> 'body') is distinct from 'string' then
      raise exception 'invalid_settings' using errcode = '22023';
    end if;
    v_body := v_item ->> 'body';
    select * into v_template
    from public.message_templates t
    where t.id = (v_item ->> 'id')::uuid
    for update;
    if not found then
      raise exception 'template_not_found' using errcode = 'P0002';
    end if;
    if v_template.body is distinct from v_body then
      update public.message_templates
      set body = v_body, updated_by = (select auth.uid())
      where id = v_template.id;
      insert into public.audit_log (actor_id, action, entity, entity_id, details)
      values (
        (select auth.uid()), 'template.update', 'message_template', v_template.id,
        jsonb_build_object(
          'fields', jsonb_build_array('body'),
          'kind', v_template.kind,
          'locale', v_template.locale
        )
      );
      v_templates_changed := v_templates_changed + 1;
    end if;
  end loop;

  return jsonb_build_object(
    'days_changed', v_days_changed,
    'templates_changed', v_templates_changed
  );
end;
$$;

-- Screens ----------------------------------------------------------------------------------------

-- The Today screen as in *_reminders.sql; a "remind" row also carries the client's message language.
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
      c.phone,
      c.phone_owner,
      c.parent_name,
      c.message_locale,
      g.name as group_name,
      g.default_price as price,
      cs.ends_on,
      d.payment_id as remind_payment_id,
      d.kind as remind_kind,
      d.client_id is not null as remind,
      c.id in (select client_id from paid) as paid
    from public.clients c
    join public.client_status(p_today) cs on cs.client_id = c.id
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
            'phone_owner', r.phone_owner,
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

-- The client card as in *_reminders.sql, plus the message language and what the card's reminder
-- preview needs: the subscription it is about, the kind that fits today and the reminder context.
-- The kind: "overdue" once the subscription has ended; the kind due today if one is; otherwise the
-- early reminder. Still one call.
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
      'message_locale', c.message_locale,
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
  left join public.groups g on g.id = c.group_id
  left join public.staff s on s.id = g.coach_id
  where c.id = p_client_id
    and c.deleted_at is null;
$$;

-- Client writes ----------------------------------------------------------------------------------

-- As in *_clients_management.sql, with the message language. A new argument changes the signature,
-- so the old functions are dropped rather than overloaded (an overload with defaults is ambiguous).
drop function public.create_client(text, text, text, text, date, date, text, uuid, text, text[]);
drop function public.update_client(uuid, text, text, text, text, date, date, text, uuid, text, text[]);

create function public.create_client(
  p_last_name text,
  p_first_name text,
  p_phone text,
  p_phone_owner text,
  p_started_on date,
  p_birth_date date default null,
  p_parent_name text default null,
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
  v_consents text[];
begin
  perform public.require_staff_role(array['owner', 'admin']);
  perform public.check_client_group(p_group_id);

  insert into public.clients (
    last_name, first_name, birth_date, phone, phone_owner, parent_name, group_id, started_on, note,
    message_locale, created_by
  ) values (
    btrim(p_last_name),
    btrim(p_first_name),
    p_birth_date,
    p_phone,
    p_phone_owner,
    case when p_phone_owner = 'parent' then nullif(btrim(p_parent_name), '') end,
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
    jsonb_build_object('group_id', p_group_id, 'consents', to_jsonb(v_consents))
  );
  return v_id;
end;
$$;

-- p_message_locale null keeps the language on file.
create function public.update_client(
  p_client_id uuid,
  p_last_name text,
  p_first_name text,
  p_phone text,
  p_phone_owner text,
  p_started_on date,
  p_birth_date date default null,
  p_parent_name text default null,
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
  v_fields text[] := '{}';
  v_consents text[];
begin
  perform public.require_staff_role(array['owner', 'admin']);
  select * into v_old from public.clients c where c.id = p_client_id for update;
  if not found or v_old.deleted_at is not null then
    raise exception 'client_not_found' using errcode = 'P0002';
  end if;
  perform public.check_client_group(p_group_id, v_old.group_id);

  update public.clients
  set last_name = btrim(p_last_name),
      first_name = btrim(p_first_name),
      birth_date = p_birth_date,
      phone = p_phone,
      phone_owner = p_phone_owner,
      parent_name = case when p_phone_owner = 'parent' then nullif(btrim(p_parent_name), '') end,
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
  if v_old.phone_owner is distinct from v_new.phone_owner then
    v_fields := array_append(v_fields, 'phone_owner');
  end if;
  if v_old.parent_name is distinct from v_new.parent_name then
    v_fields := array_append(v_fields, 'parent_name');
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
        'to_group_id', case when 'group_id' = any (v_fields) then v_new.group_id end
      )
    );
  end if;
end;
$$;

grant execute on function public.create_client(
  text, text, text, text, date, date, text, uuid, text, text[], text
) to authenticated, service_role;
grant execute on function public.update_client(
  uuid, text, text, text, text, date, date, text, uuid, text, text[], text
) to authenticated, service_role;

-- Import as in *_client_import.sql; a row may carry message_locale (the "Язык" column), null or
-- missing means Russian. A wrong value is stopped by clients_message_locale_check (23514).
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
      ends_on date,
      message_locale text
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
      last_name, first_name, phone, phone_owner, group_id, started_on, message_locale, created_by
    ) values (
      btrim(v_row.last_name), btrim(v_row.first_name), v_row.phone, 'self', v_group_id, p_today,
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

grant execute on function public.reminder_template_for(uuid, text) to authenticated, service_role;
