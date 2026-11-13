-- Message templates, reminder events, gym settings and the audit log.

-- settings (single row) ------------------------------------------------------------------------

create table public.settings (
  id boolean primary key default true check (id),
  -- STUB(D-01): placeholder gym name until the customer provides the real one.
  gym_name text not null default 'Зал вольной борьбы'
    check (char_length(btrim(gym_name)) between 1 and 100),
  gym_whatsapp text check (gym_whatsapp ~ '^\+77\d{9}$'),
  -- STUB(D-05): remind 7 and 1 days before the end. Reminder kinds name the earlier and the later
  -- reminder (before_7 / before_1), so at most two distinct values are allowed.
  reminder_days integer[] not null default '{7,1}'
    check (
      cardinality(reminder_days) between 1 and 2
      and (cardinality(reminder_days) = 1 or reminder_days[1] <> reminder_days[2])
      and array_position(reminder_days, null) is null
      and 1 <= all (reminder_days)
      and 60 >= all (reminder_days)
    ),
  timezone text not null default 'Asia/Almaty' check (timezone = 'Asia/Almaty'),
  updated_at timestamptz not null default now()
);

alter table public.settings enable row level security;

create trigger settings_set_updated_at
  before update on public.settings
  for each row execute function public.set_updated_at();

insert into public.settings default values;

-- Admins need the gym number and reminder days to build wa.me links.
create policy settings_select on public.settings
  for select to authenticated
  using ((select public.current_staff_role()) in ('owner', 'admin'));

create policy settings_update on public.settings
  for update to authenticated
  using ((select public.current_staff_role()) = 'owner')
  with check ((select public.current_staff_role()) = 'owner');

-- message_templates ----------------------------------------------------------------------------

create table public.message_templates (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(btrim(name)) between 1 and 100),
  kind text not null check (kind in ('before_7', 'before_1', 'overdue')),
  body text not null check (char_length(btrim(body)) between 1 and 1000),
  -- null = shipped default, not yet edited by anyone.
  updated_by uuid references public.staff (id) on delete restrict,
  updated_at timestamptz not null default now()
);

alter table public.message_templates enable row level security;

create trigger message_templates_set_updated_at
  before update on public.message_templates
  for each row execute function public.set_updated_at();

-- STUB(D-05): neutral placeholder texts; the owner edits them in the reminders step.
insert into public.message_templates (name, kind, body) values
  (
    'За 7 дней',
    'before_7',
    'Здравствуйте, {имя}! Абонемент в {название_зала} заканчивается {дата_окончания}. Сумма продления: {сумма} тенге.'
  ),
  (
    'За 1 день',
    'before_1',
    'Здравствуйте, {имя}! Напоминаем: абонемент в {название_зала} заканчивается завтра, {дата_окончания}. Сумма продления: {сумма} тенге.'
  ),
  (
    'В день окончания',
    'overdue',
    'Здравствуйте, {имя}! Абонемент в {название_зала} закончился {дата_окончания}. Продлить можно у администратора, сумма: {сумма} тенге.'
  );

create policy message_templates_select on public.message_templates
  for select to authenticated
  using ((select public.current_staff_role()) in ('owner', 'admin'));

create policy message_templates_insert on public.message_templates
  for insert to authenticated
  with check (
    (select public.current_staff_role()) = 'owner'
    and updated_by = (select auth.uid())
  );

create policy message_templates_update on public.message_templates
  for update to authenticated
  using ((select public.current_staff_role()) = 'owner')
  with check (
    (select public.current_staff_role()) = 'owner'
    and updated_by = (select auth.uid())
  );

-- reminder_events ------------------------------------------------------------------------------

create table public.reminder_events (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null,
  payment_id uuid not null,
  -- Meaning, not a day count: the actual days come from settings.reminder_days.
  kind text not null check (kind in ('before_7', 'before_1', 'overdue')),
  -- "chat_opened" only means the wa.me link was opened; "marked_sent" is a separate manual mark.
  status text not null default 'chat_opened' check (status in ('chat_opened', 'marked_sent')),
  template_id uuid not null references public.message_templates (id) on delete restrict,
  opened_by uuid not null default auth.uid() references public.staff (id) on delete restrict,
  opened_at timestamptz not null default now(),
  marked_sent_by uuid references public.staff (id) on delete restrict,
  marked_sent_at timestamptz,
  -- A repeated click must not create a second event for the same subscription and kind.
  constraint reminder_events_payment_kind_unique unique (payment_id, kind),
  constraint reminder_events_payment_client_fk foreign key (payment_id, client_id)
    references public.payments (id, client_id) on delete restrict,
  constraint reminder_events_sent_mark check (
    (status = 'chat_opened' and marked_sent_by is null and marked_sent_at is null)
    or (status = 'marked_sent' and marked_sent_by is not null and marked_sent_at is not null)
  )
);

alter table public.reminder_events enable row level security;

create index reminder_events_client_id_idx on public.reminder_events (client_id);
create index reminder_events_opened_at_idx on public.reminder_events (opened_at);

create function public.check_reminder_event_insert()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not exists (
    select 1 from public.payments p where p.id = new.payment_id and p.kind = 'payment'
  ) then
    raise exception 'a reminder must reference a payment, not a reversal' using errcode = '23514';
  end if;
  return new;
end;
$$;

-- The only allowed change is chat_opened -> marked_sent; everything else stays as recorded.
create function public.check_reminder_event_update()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if old.status <> 'chat_opened' or new.status <> 'marked_sent' then
    raise exception 'reminder status can only change from chat_opened to marked_sent'
      using errcode = 'P0001';
  end if;
  if (new.id, new.client_id, new.payment_id, new.kind, new.template_id, new.opened_by, new.opened_at)
     is distinct from
     (old.id, old.client_id, old.payment_id, old.kind, old.template_id, old.opened_by, old.opened_at)
  then
    raise exception 'only the sent mark of a reminder can change' using errcode = 'P0001';
  end if;
  -- The moment of the mark is the server's, whatever the caller sent.
  new.marked_sent_at := now();
  return new;
end;
$$;

create trigger reminder_events_check_insert
  before insert on public.reminder_events
  for each row execute function public.check_reminder_event_insert();

create trigger reminder_events_check_update
  before update on public.reminder_events
  for each row execute function public.check_reminder_event_update();

create trigger reminder_events_no_delete
  before delete on public.reminder_events
  for each row execute function public.forbid_change();

create trigger reminder_events_no_truncate
  before truncate on public.reminder_events
  for each statement execute function public.forbid_change();

create policy reminder_events_select on public.reminder_events
  for select to authenticated
  using ((select public.current_staff_role()) in ('owner', 'admin'));

create policy reminder_events_insert on public.reminder_events
  for insert to authenticated
  with check (
    (select public.current_staff_role()) in ('owner', 'admin')
    and opened_by = (select auth.uid())
    and status = 'chat_opened'
  );

create policy reminder_events_update on public.reminder_events
  for update to authenticated
  using ((select public.current_staff_role()) in ('owner', 'admin'))
  with check (
    (select public.current_staff_role()) in ('owner', 'admin')
    and marked_sent_by = (select auth.uid())
  );

-- audit_log (append-only) ----------------------------------------------------------------------

create table public.audit_log (
  id uuid primary key default gen_random_uuid(),
  actor_id uuid references public.staff (id) on delete restrict,
  action text not null check (action ~ '^[a-z_]+\.[a-z_]+$'),
  entity text not null check (entity ~ '^[a-z_]+$'),
  entity_id uuid,
  -- Ids and names of changed fields only, never names or phone numbers.
  details jsonb not null default '{}'::jsonb check (jsonb_typeof(details) = 'object'),
  created_at timestamptz not null default now()
);

alter table public.audit_log enable row level security;

create index audit_log_created_at_idx on public.audit_log (created_at desc);

create trigger audit_log_append_only
  before update or delete on public.audit_log
  for each row execute function public.forbid_change();

create trigger audit_log_no_truncate
  before truncate on public.audit_log
  for each statement execute function public.forbid_change();

create policy audit_log_select on public.audit_log
  for select to authenticated
  using ((select public.current_staff_role()) = 'owner');

-- Every employee's actions are logged, so admins write entries they cannot read back.
create policy audit_log_insert on public.audit_log
  for insert to authenticated
  with check (
    (select public.current_staff_role()) in ('owner', 'admin')
    and actor_id = (select auth.uid())
  );
