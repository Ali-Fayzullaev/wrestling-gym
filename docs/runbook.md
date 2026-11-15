# Runbook: production, бэкапы, восстановление, ключи

Для владельца проекта и разработчика. Секреты здесь не хранятся: только их имена и где они лежат.

> STUB(D-06): production ещё не создан. Тарифы, кто платит и домен ждут решения заказчика
> ([90-open-decisions.md](spec/90-open-decisions.md)). Пока решения нет, workflow `Deploy production`
> и `Backup` выключены переменной `PRODUCTION_ENABLED`. Ниже всё готово к включению.

## 1. Из чего состоит production

| Часть | Где | Настройка |
| --- | --- | --- |
| База и вход | Supabase, регион `eu-central-1` (Франкфурт) | тариф по D-06 |
| Приложение | Vercel, функции в `fra1` (Франкфурт) | [vercel.json](../vercel.json) |
| Схема БД | только миграции из `supabase/migrations` | применяет [deploy.yml](../.github/workflows/deploy.yml) |
| Деплой | preview на каждый PR (Vercel Git), production после зелёного CI на `main` | [deploy.yml](../.github/workflows/deploy.yml) |
| Бэкап | каждую ночь в 02:30 по Шымкенту | [backup.yml](../.github/workflows/backup.yml) |
| Заголовки безопасности | CSP с nonce, HSTS и другие | [src/proxy.ts](../src/proxy.ts), [src/lib/security-headers.ts](../src/lib/security-headers.ts) |

База и функции в одном городе: каждый запрос страницы идёт в базу 2–3 раза, и задержка между регионами
сложилась бы в заметное ожидание.

## 2. Первый запуск (один раз, после решения D-06)

### 2.1. Supabase

1. Создать проект в регионе `eu-central-1`. Пароль базы сохранить в менеджере паролей.
2. Authentication → Sign In / Providers:
   - выключить «Allow new users to sign up» (сотрудников приглашает владелец);
   - Email: включён, «Confirm email» включён;
   - минимальная длина пароля 8.
3. Authentication → URL Configuration:
   - Site URL: `https://<домен>`;
   - Redirect URLs: `https://<домен>/auth/confirm` (ссылки из писем сброса и приглашения ведут сюда).
4. Authentication → Emails → Templates, тексты из репозитория:
   - Reset password: тема «Сброс пароля», тело из [supabase/templates/recovery.html](../supabase/templates/recovery.html);
   - Invite user: тема «Приглашение в сервис учёта абонементов», тело из [supabase/templates/invite.html](../supabase/templates/invite.html).
5. Authentication → Emails → SMTP: свой SMTP-сервер (встроенный Supabase отправляет только
   несколько писем в час и не для production). Отправитель: адрес на домене зала.
6. Authentication → Rate Limits: оставить значения по умолчанию. Приложение само ограничивает попытки
   входа и сброса пароля по email и IP (таблица `auth_attempts`).
7. Project Settings → Data API: убедиться, что открыта только схема `public`.
8. Advisors (Security и Performance): нет предупреждений уровня ERROR.

### 2.2. GitHub

Settings → Environments → создать `production`, в нём:

| Имя | Тип | Что это |
| --- | --- | --- |
| `SUPABASE_ACCESS_TOKEN` | secret | личный токен Supabase для `supabase db push` |
| `SUPABASE_DB_PASSWORD` | secret | пароль базы production |
| `SUPABASE_PROJECT_REF` | variable | идентификатор проекта Supabase |
| `PRODUCTION_DATABASE_URL` | secret | строка подключения Session pooler (порт 5432, IPv4) для бэкапа |
| `BACKUP_AGE_RECIPIENT` | variable | публичный ключ age (`age1...`), см. 2.4 |
| `VERCEL_TOKEN` | secret | токен Vercel для деплоя из CI |
| `VERCEL_ORG_ID`, `VERCEL_PROJECT_ID` | variable | из `.vercel/project.json` после `vercel link` |

Последним шагом: Settings → Variables (уровень репозитория) → `PRODUCTION_ENABLED` = `true`.

### 2.3. Vercel

1. Создать проект из репозитория, Framework: Next.js. Регион функций берётся из `vercel.json` (`fra1`).
2. Environment Variables, отдельно для каждого окружения:

   | Имя | Production | Preview |
   | --- | --- | --- |
   | `SUPABASE_URL` | production-проект | dev-проект |
   | `SUPABASE_PUBLISHABLE_KEY` | production-проект | dev-проект |
   | `SUPABASE_SECRET_KEY` | production-проект (Sensitive) | dev-проект (Sensitive) |

   Ни одна переменная не начинается с `NEXT_PUBLIC_`: в браузер ничего не уходит.
3. Domains: добавить `<домен>` и `www.<домен>` с редиректом `www` → без `www` (308). HTTPS выдаёт Vercel.
4. Deployment Protection для preview: Vercel Authentication включена (preview работает с dev-данными,
   но посторонним он не нужен).
5. Git-деплой ветки `main` выключен в `vercel.json`: production выкатывает только CI, после миграций.

### 2.4. Ключ шифрования бэкапов

Владелец создаёт пару ключей у себя на компьютере, приватный ключ в GitHub не попадает:

```
age-keygen -o gym-backup-key.txt
```

- строку `# public key: age1...` записать в `BACKUP_AGE_RECIPIENT`;
- файл `gym-backup-key.txt` хранить офлайн в двух местах (менеджер паролей и флешка в сейфе).
  Без него бэкап не расшифровать никому, в том числе разработчику.

### 2.5. Первый владелец

После первого деплоя (миграции применены) с компьютера разработчика:

```
SUPABASE_URL=https://<ref>.supabase.co SUPABASE_SECRET_KEY=<из Supabase> \
  pnpm owner:create --email <почта владельца> --name "<Имя Фамилия>" --site https://<домен>
```

Ключи передаются через окружение, не аргументами, поэтому не попадают в историю оболочки.
Владелец получает письмо-приглашение и сам задаёт пароль: пароль не проходит через скрипт.
Скрипт отказывает, если в базе уже есть хоть один сотрудник; запрет закреплён в БД
(функция `bootstrap_owner`, только `service_role`). Остальных сотрудников владелец приглашает в
разделе «Настройки».

### 2.6. Проверка после запуска

- `https://<домен>` открывается, `http://` и `www` перенаправляют на `https://<домен>`.
- securityheaders.com: уровень A или выше.
- Lighthouse mobile на `/login`, `/today`, `/clients`: Performance 90+, Accessibility 95+, Best Practices 95+.
- Actions → Backup → Run workflow: зелёный, артефакт `backup-<дата>` появился.

## 3. Бэкапы

- Что входит: все данные схемы `public`, а также `auth.users` и `auth.identities` (пароли в виде хэшей).
  Схема БД в бэкап не входит, она восстанавливается миграциями из репозитория.
- Как устроено: `pg_dump` → проверка восстановления в чистую БД на том же раннере со сверкой
  числа строк в каждой таблице → шифрование `age` → артефакт workflow, хранится 30 дней.
  В репозиторий и логи попадают только названия таблиц и число строк.
- Если бэкап упал: workflow открывает issue «Backup failed <дата>», GitHub также шлёт письмо.
  Открыть лог по ссылке из issue, исправить, запустить Backup вручную (Run workflow).

## 4. Восстановление из бэкапа

Нужны: приватный ключ age, доступ к репозиторию, PostgreSQL 17 client (`pg_restore`, `psql`), `age`, `gh`.

1. Скачать артефакт нужной даты:
   ```
   gh run list --workflow=backup.yml
   gh run download <run-id> --dir restore
   ```
2. Расшифровать и распаковать:
   ```
   age -d -i gym-backup-key.txt restore/backup-<дата>/backup-<дата>.tar.gz.age | tar -xzf -
   ```
   Появится папка `dump` с `public.dump`, `auth.dump`, `counts.tsv`.
3. Подготовить пустую базу со схемой:
   - новый проект Supabase (тот же регион): `pnpm supabase link --project-ref <новый ref>`, затем
     `pnpm supabase db push`;
   - или локально для проверки: `pnpm db:start`, `pnpm supabase db reset --no-seed`.
4. Восстановить:
   ```
   DATABASE_URL=<строка подключения к новой базе> scripts/backup/restore.sh dump
   ```
   Скрипт работает одной транзакцией и сверяет число строк с `counts.tsv`. Он откажет, если в базе
   уже есть сотрудники или пользователи: восстанавливать можно только в новую базу.
5. Если восстанавливали в новый проект: переключить `SUPABASE_URL` и ключи в Vercel (Production),
   повторить настройки Auth из 2.1, обновить секреты GitHub из 2.2, сделать Redeploy.
6. Войти владельцем, открыть «Сегодня», «Клиенты», «Отчёты»: данные на месте.

### Журнал проверок восстановления

| Дата | Что проверяли | Результат |
| --- | --- | --- |
| 2026-11-15 | Репетиция на локальном Supabase (сиды как замена production): `dump.sh` → `age` → расшифровка (копия совпала побайтно, без ключа файл не читается) → `db reset --no-seed` → `restore.sh` | Все 12 таблиц совпали: `auth.users` 3, `auth.identities` 3, `clients` 150, `consents` 233, `payments` 247, `reminder_events` 14, `groups` 6, `audit_log` 6, `message_templates` 3, `settings` 1, `staff` 3, `auth_attempts` 0. Вход владельцем после восстановления работает. Повторный запуск в базу с данными отклонён. |
| — | Первый бэкап production по расписанию и восстановление в отдельный проект | ждёт D-06 |

## 5. Ротация ключей

Плановая раз в год и сразу при уходе человека с доступом.

| Ключ | Где создаётся | Порядок |
| --- | --- | --- |
| `SUPABASE_SECRET_KEY` | Supabase → API Keys | создать новый secret key → обновить в Vercel (Production) → Redeploy → проверить вход → удалить старый ключ |
| `SUPABASE_PUBLISHABLE_KEY` | Supabase → API Keys | так же, как secret key |
| Пароль БД | Supabase → Database → Reset password | сменить → обновить `SUPABASE_DB_PASSWORD` и `PRODUCTION_DATABASE_URL` в GitHub → запустить Backup вручную |
| `SUPABASE_ACCESS_TOKEN` | Supabase → Account → Access Tokens | создать новый → обновить в GitHub → отозвать старый |
| `VERCEL_TOKEN` | Vercel → Account → Tokens | создать новый (срок 1 год) → обновить в GitHub → удалить старый |
| Ключ age | компьютер владельца, `age-keygen` | создать новую пару → обновить `BACKUP_AGE_RECIPIENT` → старый приватный ключ хранить 30 дней (пока живут старые бэкапы), затем уничтожить |

Сессии сотрудников после ротации ключей API не обрываются: ключи подписи JWT меняются отдельно
(Supabase → JWT Keys) и только при подозрении на утечку.

## 6. Если случилась утечка

1. Ключ `service_role`/secret key или пароль БД: сразу ротировать по разделу 5. При подозрении на
   утечку ключа подписи JWT: Supabase → JWT Keys → ротация (все сотрудники войдут заново).
2. Аккаунт сотрудника: «Настройки» → «Сотрудники» → отключить доступ (действует со следующего
   запроса), затем сброс пароля.
3. Посмотреть, что делали: раздел «Журнал» (владелец), Supabase → Logs (Auth, API), Vercel → Logs.
4. Если затронуты персональные данные клиентов: владелец решает об уведомлении по Закону РК «О
   персональных данных и их защите». Разработчик даёт список затронутых таблиц и период; сами
   данные в переписку не копировать.
5. Записать, что произошло и что изменили, в раздел 8 этого файла.

## 7. Контакты

> STUB(D-06): заполнить при запуске. Персональные данные сюда не писать, только роли и где искать.

| Роль | Кто | Как связаться |
| --- | --- | --- |
| Владелец (решения, ключ age, оплата сервисов) | — | — |
| Разработчик (код, деплой, восстановление) | — | — |
| Поддержка Supabase | — | supabase.com/support |
| Поддержка Vercel | — | vercel.com/help |

## 8. Журнал инцидентов

| Дата | Что случилось | Что сделали |
| --- | --- | --- |
| — | — | — |
