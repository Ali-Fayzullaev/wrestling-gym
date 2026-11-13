# 03. Вход и роли

Статус: done
Зависит от: 02
Ветка: `step/03-auth`
Навыки: `backend-development`, `secure-coding`

## Цель

Только сотрудники входят в систему, каждый видит и делает ровно то, что разрешено его роли, и потеря доступа срабатывает сразу.

## Что входит

- Supabase Auth email + пароль через `@supabase/ssr`, сессия в httpOnly cookie.
- Страница `/login` (простая, токены дизайна подключатся в 04), `/reset-password` (запрос письма) и `/update-password` (новый пароль по ссылке).
- `middleware.ts`: обновление сессии, редирект неавторизованных на `/login`, проверка `staff.active`.
- Серверный хелпер `requireStaff(roles)` → `Actor { id, role }` или редирект/ошибка; используется во всех Server Actions и защищённых страницах.
- Карта доступа маршрутов: `/reports`, `/audit`, `/settings/staff` только `owner` (страницы-заглушки для проверки).
- Ограничение попыток входа: по email и по IP (настройки Supabase Auth + собственная таблица/функция, если встроенного недостаточно). Сообщение «Слишком много попыток, попробуйте через N минут».
- Выход из системы.
- Ошибки входа без раскрытия, существует ли email.
- Запись входа в `audit_log` (`staff.login`).

## Что не входит

Управление сотрудниками (шаг 12), дизайн экрана (шаг 04 доведёт внешний вид).

## Критерии готовности

1. E2E: верный пароль → `/today`; неверный → понятная ошибка, без раскрытия email.
2. E2E: неавторизованный переход на `/clients` → `/login`, после входа возвращает на исходный адрес (только внутренние пути, тест на open redirect).
3. E2E: `admin` открывает `/reports` → отказ (403-страница), `owner` → видит.
4. Интеграция: `requireStaff(['owner'])` для `admin` возвращает отказ.
5. Интеграция/e2e: деактивированный сотрудник на следующем запросе выкинут на `/login`.
6. После N неудачных попыток вход блокируется на время, тест это проверяет.
7. Cookie сессии `httpOnly`, `secure` (в production), `sameSite=lax`.
8. Сброс пароля: письмо уходит (локальный Inbucket/Mailpit в тесте), ссылка ведёт на смену пароля.

## Чек-лист

- [x] Клиенты Supabase (server, middleware/proxy); браузерный клиент не нужен: вход, выход и проверка сессии идут на сервере
- [x] `/login`, `/reset-password`, `/update-password`, выход
- [x] `src/proxy.ts` (бывший `middleware.ts`, переименован в Next 16) + проверка `active`
- [x] `requireStaff`
- [x] Rate limit входа (таблица `auth_attempts`, 5 попыток на email и 20 на IP за 15 минут; сброс пароля 3 и 10)
- [x] Аудит входа (`staff.login`, плюс `staff.password_change`)
- [x] Тесты 1–8
- [x] `/security-review`
- [x] PR, CI зелёный, отчёт

## Как закрыты критерии

| Критерий | Тест |
| --- | --- |
| 1. Верный пароль ведёт на `/today`, неверный даёт одинаковую ошибку | e2e `sign-in › right password…`, `wrong password and unknown email…`; интеграция `signIn › answers a wrong password and an unknown email identically` |
| 2. Возврат на исходный адрес, без open redirect | e2e `returns to the page that asked for sign-in`, `ignores an external return address …` (3 варианта); unit `safe-next-path.test.ts` |
| 3. `admin` получает 403 на `/reports`, `/audit`, `/settings/staff`, `owner` видит | e2e `roles › …` (проверяется HTTP-статус 403) |
| 4. `requireStaff(['owner'])` отказывает `admin` | интеграция `authorizeStaff › refuses an admin where only the owner is allowed` (`requireStaff` — тонкая обёртка над `authorizeStaff`) |
| 5. Деактивированный сотрудник выкинут на следующем запросе | e2e `a deactivated employee is sent to sign-in…`; интеграция `authorizeStaff › refuses a deactivated employee…` |
| 6. Блокировка после N неудач | интеграция `auth-throttle.test.ts` (окно, сброс после успеха, IP, параллельная серия 10 → 5); e2e `blocks sign-in after 5 failed attempts…` |
| 7. Cookie `httpOnly`, `secure` (production), `sameSite=lax` | e2e проверяет атрибуты cookie после входа (`next start` — production-сборка, `secure` включён); unit `cookie-options.test.ts` |
| 8. Письмо сброса уходит, ссылка ведёт на смену пароля | e2e `the emailed link opens the new-password form…` (письмо читается из локального Mailpit) |

Проверка в браузере: 390 и 1440 px, светлая и тёмная схема, скриншоты в `docs/spec/screenshots/03/`. Lighthouse mobile `/login`: Performance 98, Accessibility 100, Best Practices 100, LCP 2,2 с, CLS 0. JS первой загрузки `/login` 147,7 КБ gzip.

## Заметки на будущее

- Next 16.4 с `cacheComponents`: форма на частично пререндеренной странице (◐ в выводе `next build`), отправленная до гидратации, возвращает пустую страницу. На полностью статической (○) работает. Поэтому `/login`, `/reset-password`, `/update-password` статические, `next` для входа берётся из `Referer` (тест `works when submitted before the scripts have loaded`). Учитывать в формах шагов 05–07.
- Next 16.4: статус из `NextResponse.rewrite(..., { status })` к странице игнорируется. Поэтому `/forbidden` — route handler с простым HTML и статусом 403. Шаг 04 может переоформить его текст, но не превращать в страницу.
- В route handler `request.url` содержит хост, на котором слушает сервер (`localhost`), а не тот, что открыл браузер. Редиректы делать относительным `Location`.
- После входа и выхода выполняется полная загрузка страницы (`useHardNavigation`): мягкий переход роутера показывал меню предыдущего сотрудника (тест `the next employee on the same device…`). Ответы вошедшему сотруднику с `Cache-Control: private, no-store`.
- Переменные Supabase только серверные: `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY`, `SUPABASE_SECRET_KEY` (шаг 13: завести в Vercel под этими именами, `NEXT_PUBLIC_*` не нужны).
- Шаг 13, Supabase Auth в production: шаблон письма сброса из `supabase/templates/recovery.html` (ссылка с `token_hash` на `/auth/confirm`); список redirect URL точный (`https://<домен>/auth/confirm`), без широких масок; регистрация выключена; минимальная длина пароля 8; SMTP. Auth видит все входы с IP Vercel, поэтому встроенный лимит входов на IP поднять (свои лимиты по email и IP в `auth_attempts`).
- Шаг 13: `clientIp` доверяет `x-forwarded-for`, это верно только за Vercel. `Referrer-Policy: strict-origin-when-cross-origin` совместим с возвратом после входа (same-origin Referer сохраняет путь).
- Шаг 04: тёмная тема на страницах приложения не включается (сейчас тёмная только `/forbidden` через `color-scheme`); `Field` и шапка временные. LCP `/login` 2,2 с при цели 1,5 с: первая отрисовка 0,8 с, остальное — задержка рендера подзаголовка; на заглушке шага 01 было 2,0 с.
- JS первой загрузки `/login` 147,7 КБ при бюджете 150 КБ: на страницах входа вместо `next/link` обычные ссылки. Новые клиентские компоненты на этих страницах сверять с бюджетом.
- Шаг 12: `writeAudit` пока внутри `features/auth/service.ts` (вставка без `returning`). Тесты создают временных сотрудников `test-<uuid>@example.test` (их нельзя удалить, на них ссылается журнал); локальная БД очищается `pnpm db:reset`, в CI база свежая.
- Lighthouse замерен только для `/login`: остальные маршруты этого шага — заглушки за входом.
