# 01. Каркас проекта

Статус: in-progress
Зависит от: 00
Ветка: `step/01-scaffold`

## Цель

Пустое, но полностью рабочее приложение: каждый следующий шаг только добавляет функции, а все проверки (типы, линтер, формат, unit, интеграция, e2e, сборка) уже работают локально и в CI.

## Что входит

- Next.js последней стабильной версии (сверить через context7/документацию), App Router, TypeScript strict (`strict`, `noUncheckedIndexedAccess`, `noImplicitOverride`), `src/`-директория, алиас `@/*`.
- pnpm, `packageManager` и `engines.node` в `package.json`, `.nvmrc`.
- Tailwind CSS и инициализация shadcn/ui (без компонентов, кроме `button` для проверки).
- ESLint (flat config, `next/core-web-vitals`, `@typescript-eslint` strict, запрет `any`, правило `import/no-restricted-paths` или аналог для направления `app → features → lib, db`).
- Prettier + `prettier-plugin-tailwindcss`.
- Vitest: проекты `unit` (`src/**/*.test.ts`) и `integration` (`tests/integration/**/*.test.ts`, против локального Supabase).
- Playwright: проекты `mobile` (390×844) и `desktop` (1440×900), запуск против `next build && next start`.
- Supabase CLI как dev-зависимость, `supabase init`, `config.toml` (signup отключён), пустая первая миграция не нужна.
- Скрипты: `dev`, `build`, `start`, `typecheck`, `lint`, `format`, `format:check`, `test:unit`, `test:int`, `test:e2e`, `db:start`, `db:stop`, `db:reset`, `db:types`, `check` (всё по порядку).
- Папки по CLAUDE.md: `src/app`, `src/features`, `src/lib`, `src/db`, `src/i18n`, `tests/integration`, `tests/e2e`.
- Временная главная страница с текстом из `src/i18n/ru.ts`.
- `.env.example`, `.gitignore` (включая `.env*`, `!.env.example`, `.lighthouse`, `playwright-report`).
- GitHub Actions `ci.yml`: на push и PR; кеш pnpm; job `checks` (typecheck, lint, format:check, test:unit, build с выводом размеров), job `integration` (supabase start в CI, `db:reset`, `test:int`), job `e2e` (Playwright, артефакт отчёта при падении). Concurrency с отменой старых запусков.
- Обновить таблицу команд в CLAUDE.md.

## Что не входит

Схема БД, вход, дизайн-токены, любые бизнес-экраны.

## Критерии готовности

1. `pnpm check` зелёный на чистом клоне (после `pnpm install` и `pnpm db:start`).
2. Пример unit-теста (`src/lib/*.test.ts`) проходит.
3. Пример интеграционного теста подключается к локальному Supabase и выполняет `select 1`.
4. E2E-тест открывает главную на `mobile` и `desktop`, видит текст и не видит ошибок в консоли.
5. Нарушение направления зависимостей (импорт `@/app` из `src/lib`) ломает `pnpm lint` (проверено временным файлом).
6. `any` ломает `pnpm lint`.
7. CI зелёный на PR.
8. JS первой загрузки главной из `next build` записан в отчёт.

## Чек-лист

- [ ] Создать приложение, включить strict-настройки
- [ ] Tailwind + shadcn/ui init
- [ ] ESLint + Prettier + правило границ модулей
- [ ] Vitest (unit, integration)
- [ ] Playwright (mobile, desktop) + проверка консоли
- [ ] Supabase CLI, `supabase init`, signup выключен
- [ ] Скрипты и `pnpm check`
- [ ] `.env.example`, `.gitignore`
- [ ] GitHub Actions
- [ ] Команды в CLAUDE.md
- [ ] PR, CI зелёный, отчёт

## Заметки на будущее

- Next.js 16 убрал колонки `size` и `First Load JS` из вывода `next build` (официальная заметка «Upgrading to 16»). Размер JS первой загрузки меряет e2e-тест `tests/e2e/first-load-js.spec.ts`: сумма скачанных скриптов (gzip, по сети) от `next start`, бюджет 150 КБ. Отчёт пишется в `.perf/first-load-js.md` и в summary CI job `e2e`. При добавлении маршрутов дописывать их в `ROUTES` теста.
- Шаблон create-next-app 16.4 собирает Tailwind через Turbopack-загрузчик `@tailwindcss/turbopack` (без PostCSS) и включает `cacheComponents` и `partialPrefetching`. Учитывать в шагах 03 и далее: динамика за `<Suspense>`, `"use cache"` для кешируемого.
- shadcn 4.23 (`-b radix`) ставит пакет `cn` (shadcn-ui/cn) вместо `clsx` + `tailwind-merge`. Шрифт Geist из шаблона убран, шрифт выбирается в шаге 04.
- Markdown исключён из Prettier (`.prettierignore`): выравнивание таблиц раздувало бы diff документов.
- Правила ESLint (границы слоёв, `any`, `next/*` в `service.ts`) закреплены тестом `tests/lint/eslint-rules.test.ts` в проекте `unit`.
- Интеграционные тесты получают URL и ключи локального Supabase из `supabase status` (globalSetup + `inject`), `.env` для них не нужен.
- В CI `supabase start` запускается без studio, storage, realtime, edge-runtime и других ненужных сервисов. Если шагу понадобится storage или realtime, убрать их из `-x` в `ci.yml`.
- `supabase/config.toml`: `minimum_password_length = 6` и `password_requirements = ""` по умолчанию. Ужесточить в шаге 03 (вход) вместе с лимитом попыток.
