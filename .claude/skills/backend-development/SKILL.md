---
name: backend-development
description: Supabase (Postgres, Auth, RLS), миграции, view статусов, Server Actions, Zod, идемпотентность, время параметром, индексы. Использовать при работе с БД и серверной логикой.
---

# backend-development

## Миграции

- Схема меняется только файлами в `supabase/migrations` (`pnpm supabase migration new <name>`). Никаких правок через Studio или MCP в обход файлов.
- Миграция не редактируется после мержа в `main`; исправление — новой миграцией.
- После изменения схемы: `pnpm db:reset` (применяет миграции и `supabase/seed.sql`), затем `pnpm db:types`.
- Сиды только с вымышленными данными (имена из списка, телефоны `+770000000NN`).

## Таблицы

- `id uuid primary key default gen_random_uuid()`, `created_at timestamptz not null default now()`.
- Даты абонементов `date`, моменты времени `timestamptz`. Деньги `integer` в тенге (без копеек), `check (amount <> 0)`.
- Перечисления: `text` + `check (... in (...))` или enum; выбрать одно и держать единообразно.
- Внешние ключи с `on delete restrict` для финансовых данных.
- Архив: `archived_at timestamptz null`, не удаление.

## RLS

```sql
alter table public.x enable row level security;
-- роль из staff, active = true; функция security definer, stable, search_path = ''
create policy x_select on public.x for select to authenticated using (public.current_staff_role() in ('owner','admin'));
```

- Включать на каждой таблице в той же миграции, где таблица создаётся.
- Хелпер `public.current_staff_role()` возвращает роль только для `active` сотрудника, иначе `null` (удалённый сотрудник теряет доступ сразу).
- Денежные отчёты: отдельные view/функции, доступные только `owner`.
- Append-only (`payments`, `consents`, `audit_log`, события напоминаний кроме перехода статуса): нет политик UPDATE/DELETE плюс триггер `before update or delete` с `raise exception`.
- Тест на каждую политику: разрешённая роль может, чужая получает отказ, аноним получает отказ.

## Статус абонемента

- Одна SQL-функция/view `client_status` — единственный источник правды. В JS статус не пересчитывать.
- Параметр «сегодня» (`p_today date`), по умолчанию `(now() at time zone 'Asia/Almaty')::date`; тесты передают свою дату.
- `active` > 7 дней, `expiring` 0–7, `expired` дата прошла, `none` оплат нет. Сторно учитывается.

## Индексы

`clients(group_id)`, `clients(archived_at)`, `payments(client_id, period_end desc)`, триграммный `gin` по `lower(unaccent(фамилия || ' ' || имя || ' ' || телефон))` (`pg_trgm`). Проверять планы через `explain analyze` для тяжёлых запросов.

## Идемпотентность

- `payments.idempotency_key uuid unique not null`. Ключ генерирует форма при открытии (`crypto.randomUUID()`), повтор отправки шлёт тот же ключ.
- Вставка `insert ... on conflict (idempotency_key) do nothing returning *`; если ничего не вернулось, читаем существующую запись и отдаём её как успех.
- `reminder_events unique (payment_id, kind)`: повторное нажатие не создаёт дубль.
- Тест: два параллельных запроса с одним ключом дают ровно одну запись.

## Сервисы

```ts
// src/features/payments/service.ts
export async function recordPayment(db: Db, now: Date, actor: Actor, input: RecordPaymentInput): Promise<Result<Payment>>
```

- Принимают клиент БД, `now`, `actor` параметрами. Не импортируют `next/*`.
- Возвращают `Result` (`{ ok: true, data } | { ok: false, error: { code, message } }`), а не бросают ошибки для ожидаемых ситуаций.
- Операции из нескольких записей (оплата + audit) атомарны: SQL-функция (`rpc`) или транзакция.

## Server Actions

```ts
"use server";
export async function recordPaymentAction(raw: unknown) {
  const actor = await requireStaff(["owner", "admin"]); // сессия + роль, иначе ошибка
  const input = recordPaymentSchema.parse(raw);          // Zod на сервере
  const result = await recordPayment(await createServerDb(), new Date(), actor, input);
  if (result.ok) revalidatePath("/today");
  return result;
}
```

- Порядок всегда: сессия → роль → Zod → сервис → revalidate.
- Клиенты Supabase: серверный через `@supabase/ssr` (cookie), `service_role` только в отдельном серверном модуле с `import "server-only"`.
- Читать данные в Server Components одним запросом с узким `select`, без N+1.

## Время

- Нигде в бизнес-логике не вызывать `new Date()` / `now()` неявно; передавать параметром.
- Перевод в дату зала через `src/lib/date.ts` (`toAlmatyDate(now)`), `Asia/Almaty`.
