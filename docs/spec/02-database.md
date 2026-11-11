# 02. База данных

Статус: todo
Зависит от: 01
Ветка: `step/02-database`
Навыки: `backend-development`, `secure-coding`

## Цель

Полная схема БД с RLS, append-only защитой, функцией статуса абонемента и тестами политик. После этого шага сервер и интерфейс строятся поверх готовых и проверенных гарантий БД.

## Что входит

Миграции в `supabase/migrations`:

- Расширения: `pg_trgm`, `unaccent`.
- `staff`: `id` (= `auth.users.id`), `full_name`, `role` (`owner|admin`), `active`, `created_at`.
- `groups`: `name`, `coach_id → staff`, `schedule` (текст или jsonb: дни + время), `default_price integer`, `capacity integer null`, `archived_at`.
- `clients`: `last_name`, `first_name`, `birth_date null`, `phone` (check `^\+77\d{9}$`), `phone_owner` (`self|parent`), `parent_name null` (обязателен при `parent`), `group_id null`, `started_on`, `note`, `archived_at`, `created_by`, `created_at`, `updated_at`.
- `consents`: `client_id`, `kind` (`data_processing|messaging`), `given_on`, `recorded_by`, `created_at`. Append-only.
- `payments`: `client_id`, `kind` (`payment|reversal`), `amount integer` (payment > 0, reversal < 0), `method` (`cash|kaspi|transfer`), `period_start date`, `period_end date`, `reverses_id null → payments` (обязателен для reversal, unique), `reason null` (обязателен для reversal), `idempotency_key uuid unique`, `created_by`, `created_at`. Append-only.
- `reminder_events`: `client_id`, `payment_id`, `kind` (`before_7|before_1|overdue`; дни берутся из настроек, тип хранит смысл), `status` (`chat_opened|marked_sent`), `template_id`, `opened_by`, `opened_at`, `marked_sent_by null`, `marked_sent_at null`. Unique `(payment_id, kind)`. Разрешено только обновление `chat_opened → marked_sent` (триггер).
- `message_templates`: `name`, `kind`, `body`, `updated_by`, `updated_at`.
- `settings`: одна строка: `gym_name`, `gym_whatsapp`, `reminder_days int[]` (по умолчанию `{7,1}`), `timezone` (`Asia/Almaty`).
- `audit_log`: `actor_id`, `action`, `entity`, `entity_id`, `details jsonb` (без ПД), `created_at`. Append-only.
- Функция `current_staff_role()` (security definer, `search_path = ''`).
- Функция `client_status(p_today date default ...)` / view `client_status_v`: текущий абонемент (последний период с учётом сторно), `ends_on`, `days_left`, `status`.
- Функция `dashboard_counts(p_today date)`: четыре счётчика экрана «Сегодня».
- Триггеры append-only (`raise exception`) на `payments`, `consents`, `audit_log`.
- Индексы: `clients(group_id)`, `clients(archived_at)`, `payments(client_id, period_end desc)`, `gin` триграммный для поиска, `reminder_events(opened_at)`, `audit_log(created_at desc)`.
- RLS и политики по таблице ролей из `00-overview.md` (с учётом умолчания D-09).
- `supabase/seed.sql`: 1 owner, 2 admin, 6 групп, ~150 вымышленных клиентов во всех статусах, оплаты и сторно. Телефоны `+7700000XXXX`.
- `pnpm db:types` → `src/db/types.ts`.

## Что не входит

Server Actions, интерфейс, вход (кроме тестовых пользователей в сидах).

## Критерии готовности (все интеграционными тестами)

1. Для каждой таблицы: аноним получает отказ на select/insert.
2. Для каждой политики: разрешённая роль может, чужая получает отказ (например, `admin` не читает `audit_log` и денежные агрегаты).
3. `update` и `delete` на `payments`, `consents`, `audit_log` падают для любой роли, включая `owner` и `service_role` (триггер).
4. Два параллельных insert в `payments` с одним `idempotency_key` → ровно одна запись.
5. Повторный insert `reminder_events` с тем же `(payment_id, kind)` → конфликт, одна запись.
6. Сторно: нельзя сторнировать сторно, нельзя сторнировать дважды, сумма сторно противоположна.
7. `client_status` на фиксированной дате даёт `active`/`expiring`/`expired`/`none` на границах 8, 7, 0, −1 день; сторнированная оплата не продлевает абонемент.
8. Неактивный (`active = false`) сотрудник не читает ничего.
9. Неверный телефон и `phone_owner = parent` без `parent_name` отклоняются check-ограничением.
10. `explain` поиска по триграммному индексу использует индекс (на сидах).

## Чек-лист

- [ ] Миграции таблиц и ограничений
- [ ] RLS и `current_staff_role()`
- [ ] Триггеры append-only и перехода статуса напоминания
- [ ] `client_status`, `dashboard_counts`
- [ ] Индексы
- [ ] Сиды
- [ ] Генерация типов
- [ ] Интеграционные тесты 1–10
- [ ] `/security-review`
- [ ] Схема описана кратко в этом файле (ER-список), модель в `00-overview.md` актуальна
- [ ] PR, CI зелёный, отчёт

## Заметки на будущее
