# 02. База данных

Статус: done
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

## Схема (ER-список)

Миграции: `supabase/migrations/20261113100000`…`20261113100500`. Перечисления `text + check`, деньги `integer` (тенге), даты абонементов `date`, моменты `timestamptz`, все FK `on delete restrict`.

| Таблица | Ключевые поля и связи | Чтение | Запись |
| --- | --- | --- | --- |
| `staff` | `id → auth.users`, `role owner/admin`, `active` | owner, admin | insert/update: owner |
| `groups` | `coach_id → staff`, `schedule jsonb[]`, `default_price`, `capacity`, `archived_at` | owner, admin | insert/update: owner |
| `clients` | `group_id → groups`, `phone`, `phone_owner`, `parent_name`, `created_by → staff`, `search_text` (generated, trigram) | owner, admin | insert/update: оба (`created_by` = себя, автор и `created_at` неизменны); delete: owner |
| `consents` | `client_id → clients`, `kind`, `given_on`, `recorded_by → staff` | owner, admin | insert: оба от своего имени; append-only |
| `payments` | `client_id → clients`, `kind payment/reversal`, `amount`, `period_*`, `reverses_id → payments (id, client_id)` unique, `reason`, `idempotency_key` unique | owner, admin (D-09) | insert: оба от своего имени; сторно: owner, admin только свою оплату в течение 10 минут; append-only |
| `reminder_events` | `(payment_id, client_id) → payments`, `kind`, `status`, `template_id → message_templates`, unique `(payment_id, kind)` | owner, admin | insert: оба, только `chat_opened`; update: только `chat_opened → marked_sent` от своего имени; delete запрещён |
| `message_templates` | `kind`, `body`, `updated_by → staff` (null = заводской текст) | owner, admin | insert/update: owner |
| `settings` | одна строка (`id = true`): `gym_name`, `gym_whatsapp`, `reminder_days` (1–2 значения), `timezone` | owner, admin | update: owner |
| `audit_log` | `actor_id → staff`, `action`, `entity`, `entity_id`, `details jsonb` | owner | insert: оба от своего имени; append-only |

Функции и view:

- `current_staff_role()`: роль активного сотрудника или `null` (security definer). Все политики через неё: неактивный сотрудник и пользователь без строки `staff` не видят ничего.
- `client_status(p_today)` / `client_status_v`: текущий абонемент = оплата с максимальным `period_end` без сторно; `active` > 7, `expiring` 0–7, `expired` < 0, `none`. Security invoker, RLS действует.
- `reminder_kind_for(days_left, reminder_days)`: 0 → `overdue`, большее из дней → `before_7`, меньшее → `before_1`.
- `dashboard_counts(p_today)`: `remind_today`, `debtors`, `expiring_week`, `paid_today` (без архивных клиентов и сторнированных оплат).
- `is_own_recent_payment(id)`: для политики сторно (подзапрос к `payments` в её же политике дал бы рекурсию).

Права: `anon` не имеет grant ни на одну таблицу и функцию; `authenticated` получает только те команды, которые разрешает какая-то политика, INSERT/UPDATE выданы по колонкам без `created_at`/`opened_at`/`updated_at` (время ставит сервер; иначе admin мог бы датировать свою оплату 2099 годом и сторнировать её когда угодно — найдено `/security-review`), `marked_sent_at` ставит триггер, поэтому UPDATE/DELETE append-only таблиц падают с `permission denied`, а не меняют 0 строк. У `service_role` и владельца таблиц UPDATE/DELETE/TRUNCATE останавливает триггер `forbid_change`.

## Чек-лист

- [x] Миграции таблиц и ограничений
- [x] RLS и `current_staff_role()`
- [x] Триггеры append-only и перехода статуса напоминания
- [x] `client_status`, `dashboard_counts`
- [x] Индексы
- [x] Сиды
- [x] Генерация типов
- [x] Интеграционные тесты 1–10
- [x] `/security-review`
- [x] Схема описана кратко в этом файле (ER-список), модель в `00-overview.md` актуальна
- [x] PR, CI зелёный, отчёт

## Заметки на будущее

- Критерий 10: на ~150 строках сидов планировщик честно выбирает seq scan (он дешевле). Тест проверяет `explain` с `enable_seqscan = off`: условие поиска `search_text like '%' || normalize_search(q) || '%'` обслуживается индексом `clients_search_text_trgm_idx`. Поиск в шаге 06 писать именно в этой форме.
- Шаг 06, полное удаление клиента: `consents` и `payments` append-only и ссылаются на клиента с `on delete restrict`, поэтому `delete` клиента с согласиями или оплатами упадёт. По умолчанию из файла шага 06: обезличивать данные клиента, строки оплат и согласий оставлять.
- Шаг 07: правило «admin сторнирует только свою оплату в течение 10 минут, owner любую» уже закреплено политикой `payments_insert`; SQL-функции оплаты/сторно должны работать как security invoker, чтобы политика действовала.
- Шаг 09: `reminder_events.payment_id` должен указывать на текущую оплату из `client_status.payment_id`, тип события брать из `reminder_kind_for`. `settings.reminder_days` допускает 1–2 различных значения от 1 до 60, потому что типов «до окончания» два.
- `audit_log`: admin пишет записи, но не читает их, поэтому `insert ... returning` от admin падает по RLS. `writeAudit` (шаг 12) должен вставлять без `returning`.
- Advisors Supabase (`pnpm supabase db advisors`): security-замечаний нет. INFO: FK на `staff` (`created_by`, `recorded_by`, `opened_by` и т. п.) без индексов (сотрудников не удаляют, на объёмах зала не важно), «неиспользуемые» индексы на свежей БД.
- Тест идемпотентности коммитит архивного клиента с оплатами за 2020 год (оплаты нельзя удалить). Локальная БД после `pnpm test:int` содержит такие строки; `pnpm db:reset` возвращает чистые сиды. Тесты не зависят от точного числа клиентов.
- Сиды: вход для локальных сотрудников `owner@example.test`, `admin1@example.test`, `admin2@example.test`, пароль `local-dev-only` (только локально, в production сиды не применяются).
