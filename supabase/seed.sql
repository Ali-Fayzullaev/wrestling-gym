-- Local development and test data only (applied by `supabase db reset`, never pushed to production).
-- All people are fictional; phones use the reserved +7700000XXXX range.
-- Dates are relative to "today" in Asia/Almaty, so every status is present whenever the seed runs.
--
-- Staff accounts (local only, password `local-dev-only`):
--   owner@example.test   owner
--   admin1@example.test  admin
--   admin2@example.test  admin

-- Staff -------------------------------------------------------------------------------------------

insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
  confirmation_token, recovery_token, email_change, email_change_token_new
)
select
  '00000000-0000-0000-0000-000000000000',
  u.id,
  'authenticated',
  'authenticated',
  u.email,
  extensions.crypt('local-dev-only', extensions.gen_salt('bf')),
  now(),
  '{"provider":"email","providers":["email"]}',
  '{}',
  now(),
  now(),
  '', '', '', ''
from (values
  ('00000000-0000-4000-8000-000000000001'::uuid, 'owner@example.test'),
  ('00000000-0000-4000-8000-000000000002'::uuid, 'admin1@example.test'),
  ('00000000-0000-4000-8000-000000000003'::uuid, 'admin2@example.test')
) as u (id, email);

insert into auth.identities (
  id, user_id, provider_id, provider, identity_data, last_sign_in_at, created_at, updated_at
)
select
  gen_random_uuid(),
  u.id,
  u.id::text,
  'email',
  jsonb_build_object('sub', u.id::text, 'email', u.email, 'email_verified', true),
  now(),
  now(),
  now()
from auth.users u
where u.email like '%@example.test';

insert into public.staff (id, full_name, role) values
  ('00000000-0000-4000-8000-000000000001', 'Нурлан Тестов', 'owner'),
  ('00000000-0000-4000-8000-000000000002', 'Данияр Примеров', 'admin'),
  ('00000000-0000-4000-8000-000000000003', 'Айгерим Образцова', 'admin');

-- Groups ------------------------------------------------------------------------------------------

insert into public.groups (id, name, coach_id, schedule, default_price, capacity) values
  ('10000000-0000-4000-8000-000000000001', 'Дети 6–9 лет, утро', '00000000-0000-4000-8000-000000000002',
   '[{"day":1,"start":"09:00","end":"10:00"},{"day":3,"start":"09:00","end":"10:00"},{"day":5,"start":"09:00","end":"10:00"}]',
   15000, 30),
  ('10000000-0000-4000-8000-000000000002', 'Дети 6–9 лет, вечер', '00000000-0000-4000-8000-000000000002',
   '[{"day":2,"start":"17:00","end":"18:00"},{"day":4,"start":"17:00","end":"18:00"},{"day":6,"start":"11:00","end":"12:00"}]',
   15000, 30),
  ('10000000-0000-4000-8000-000000000003', 'Подростки 10–13 лет', '00000000-0000-4000-8000-000000000003',
   '[{"day":1,"start":"18:00","end":"19:30"},{"day":3,"start":"18:00","end":"19:30"},{"day":5,"start":"18:00","end":"19:30"}]',
   18000, 25),
  ('10000000-0000-4000-8000-000000000004', 'Юноши 14–17 лет', '00000000-0000-4000-8000-000000000003',
   '[{"day":2,"start":"18:30","end":"20:00"},{"day":4,"start":"18:30","end":"20:00"},{"day":6,"start":"16:00","end":"17:30"}]',
   20000, 25),
  ('10000000-0000-4000-8000-000000000005', 'Взрослые', '00000000-0000-4000-8000-000000000001',
   '[{"day":1,"start":"20:00","end":"21:30"},{"day":3,"start":"20:00","end":"21:30"}]',
   20000, null),
  ('10000000-0000-4000-8000-000000000006', 'Соревновательная', '00000000-0000-4000-8000-000000000001',
   '[{"day":1,"start":"07:00","end":"09:00"},{"day":2,"start":"07:00","end":"09:00"},{"day":4,"start":"07:00","end":"09:00"},{"day":6,"start":"09:00","end":"11:00"}]',
   25000, 20);

-- Clients, consents, payments, reversals, reminder events ----------------------------------------

do $$
declare
  today constant date := (now() at time zone 'Asia/Almaty')::date;
  staff_ids constant uuid[] := array[
    '00000000-0000-4000-8000-000000000001',
    '00000000-0000-4000-8000-000000000002',
    '00000000-0000-4000-8000-000000000003'
  ]::uuid[];
  last_names constant text[] := array[
    'Ахметов', 'Бекенов', 'Жумабаев', 'Касымов', 'Нурланов', 'Сериков', 'Тулегенов', 'Омаров',
    'Исаев', 'Алиев', 'Каримов', 'Садыков', 'Ержанов', 'Муратов', 'Абдуллаев', 'Есенов',
    'Кенжебаев', 'Рахимов', 'Юсупов', 'Сатпаев', 'Иванов', 'Ким', 'Байжанов', 'Турсунов'
  ];
  boy_names constant text[] := array[
    'Алихан', 'Арсен', 'Бауыржан', 'Данияр', 'Ерасыл', 'Жандос', 'Ислам', 'Мирас', 'Нурасыл',
    'Рамазан', 'Санжар', 'Тимур', 'Хамза', 'Ернур', 'Азамат', 'Дамир', 'Ильяс', 'Максат'
  ];
  girl_names constant text[] := array['Аружан', 'Айлин', 'Томирис', 'Амина', 'Жасмин', 'Сабина'];
  parent_names constant text[] := array[
    'Гульнара', 'Динара', 'Сауле', 'Айгуль', 'Мадина', 'Асель', 'Ерлан', 'Марат'
  ];
  methods constant text[] := array['cash', 'kaspi', 'transfer'];
  i integer;
  group_no integer;
  is_child boolean;
  is_girl boolean;
  surname text;
  client uuid;
  price integer;
  ends_on date;
  starts_on date;
  current_payment uuid;
  extra_payment uuid;
  author uuid;
begin
  for i in 1..150 loop
    client := ('20000000-0000-4000-8000-' || lpad(i::text, 12, '0'))::uuid;
    group_no := case when i % 37 = 0 then null else 1 + i % 6 end;
    is_child := group_no in (1, 2, 3) or (group_no = 4 and i % 2 = 0);
    is_girl := i % 9 = 4;
    surname := last_names[1 + i % array_length(last_names, 1)];
    if is_girl and surname ~ '(ов|ев|ин)$' then
      surname := surname || 'а';
    end if;
    author := staff_ids[1 + i % 3];

    insert into public.clients (
      id, last_name, first_name, birth_date, phone, phone_owner, parent_name, group_id,
      started_on, note, archived_at, created_by
    ) values (
      client,
      surname,
      case when is_girl then girl_names[1 + i % array_length(girl_names, 1)]
           else boy_names[1 + (i * 7) % array_length(boy_names, 1)] end,
      case when is_child then today - make_interval(years => 6 + i % 10, days => i)
           when i % 4 = 0 then null
           else today - make_interval(years => 18 + i % 20, days => i) end,
      '+7700000' || lpad(i::text, 4, '0'),
      case when is_child then 'parent' else 'self' end,
      case when is_child then parent_names[1 + i % array_length(parent_names, 1)] end,
      case when group_no is null then null
           else ('10000000-0000-4000-8000-' || lpad(group_no::text, 12, '0'))::uuid end,
      today - (40 + i * 3),
      case when i % 11 = 0 then 'Пропускает по пятницам' else '' end,
      case when i % 30 = 7 then now() - interval '10 days' end,
      author
    );

    if i % 4 <> 0 then
      insert into public.consents (client_id, kind, given_on, recorded_by)
      values (client, 'data_processing', today - (40 + i * 3), author);
    end if;
    if i % 5 <> 0 then
      insert into public.consents (client_id, kind, given_on, recorded_by)
      values (client, 'messaging', today - (40 + i * 3), author);
    end if;

    -- Every tenth client has never paid: status "none".
    continue when i % 10 = 0;

    price := coalesce(
      (select g.default_price from public.groups g
       where g.id = ('10000000-0000-4000-8000-' || lpad(group_no::text, 12, '0'))::uuid),
      15000
    );

    -- Days left from -25 to 34: expired, expiring (incl. 0, 1 and 7 days) and active.
    ends_on := today + ((i * 37) % 60 - 25);
    starts_on := (ends_on - interval '1 month' + interval '1 day')::date;

    -- The previous month, so client cards have a payment history.
    if i % 3 <> 0 then
      insert into public.payments (
        client_id, kind, amount, method, period_start, period_end, idempotency_key, created_by,
        created_at
      ) values (
        client, 'payment', price, methods[1 + (i + 1) % 3],
        (starts_on - interval '1 month')::date, starts_on - 1,
        gen_random_uuid(), author,
        ((starts_on - interval '1 month')::date + time '10:00') at time zone 'Asia/Almaty'
      );
    end if;

    current_payment := gen_random_uuid();
    insert into public.payments (
      id, client_id, kind, amount, method, period_start, period_end, idempotency_key, created_by,
      created_at
    ) values (
      current_payment, client, 'payment', price, methods[1 + i % 3], starts_on, ends_on,
      gen_random_uuid(), author,
      (least(starts_on, today) + time '09:00' + make_interval(mins => i))
        at time zone 'Asia/Almaty'
    );

    -- A mistaken extra month that was reversed: it must not extend the subscription.
    if i % 13 = 5 then
      extra_payment := gen_random_uuid();
      insert into public.payments (
        id, client_id, kind, amount, method, period_start, period_end, idempotency_key,
        created_by, created_at
      ) values (
        extra_payment, client, 'payment', price, 'kaspi', ends_on + 1,
        (ends_on + interval '1 month')::date, gen_random_uuid(), author,
        now() - interval '2 days'
      );
      insert into public.payments (
        client_id, kind, amount, method, period_start, period_end, reverses_id, reason,
        idempotency_key, created_by, created_at
      ) values (
        client, 'reversal', -price, 'kaspi', ends_on + 1, (ends_on + interval '1 month')::date,
        extra_payment, 'Оплата отмечена по ошибке', gen_random_uuid(),
        '00000000-0000-4000-8000-000000000001', now() - interval '2 days' + interval '1 hour'
      );
    end if;

    -- Some reminders already opened (and some marked as sent) so "Remind today" is not everyone.
    if ends_on - today = 7 and i % 2 = 0 then
      insert into public.reminder_events (client_id, payment_id, kind, template_id, opened_by)
      select client, current_payment, 'before_7', t.id, author
      from public.message_templates t where t.kind = 'before_7' and t.locale = 'ru';
    elsif ends_on - today between 1 and 6 then
      insert into public.reminder_events (
        client_id, payment_id, kind, status, template_id, opened_by, opened_at, marked_sent_by,
        marked_sent_at
      )
      select client, current_payment, 'before_7', 'marked_sent', t.id, author,
             now() - make_interval(days => 7 - (ends_on - today)), author,
             now() - make_interval(days => 7 - (ends_on - today)) + interval '5 minutes'
      from public.message_templates t where t.kind = 'before_7' and t.locale = 'ru';
    end if;
  end loop;
end;
$$;

insert into public.audit_log (actor_id, action, entity, entity_id, details)
select '00000000-0000-4000-8000-000000000001', 'group.create', 'group', g.id, '{}'::jsonb
from public.groups g;
