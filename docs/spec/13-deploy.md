# 13. Деплой, домен, безопасность, бэкапы

Статус: in-progress (часть в репозитории готова; production ждёт D-06)
Зависит от: 08 (лучше после 09–12), D-06
Ветка: `step/13-deploy`
Навыки: `secure-coding`, `browser-verification`

## Цель

Приложение работает в production быстро и безопасно, данные ежедневно копируются, и восстановление проверено на практике.

## Что входит

- Supabase production-проект в `eu-central-1` (тариф по D-06), миграции применяются из CI (`supabase db push`) только при merge в `main`.
- Vercel-проект, регион функций `fra1`, переменные окружения (production и preview отдельно, preview работает с dev-проектом Supabase).
- Деплой: preview на каждый PR, production при merge в `main` после зелёного CI.
- Домен (`.kz` или другой, D-06), HTTPS, редирект `www`.
- Заголовки безопасности (CSP с nonce, HSTS, `X-Frame-Options: DENY`, `X-Content-Type-Options`, `Referrer-Policy`, `Permissions-Policy`); тест e2e проверяет заголовки.
- Настройки Supabase Auth в production: signup выключен, URL сайта и редиректы, SMTP для писем сброса пароля, лимиты.
- Бэкап: GitHub Actions по расписанию (ежедневно), `pg_dump` → шифрование (`age`/`gpg`) → приватное хранилище, хранение 30 дней, уведомление при падении.
- `docs/runbook.md`: восстановление из бэкапа по шагам, ротация ключей, что делать при утечке, контакты.
- Проверка восстановления: развернуть бэкап в отдельный проект/локально, сверить количество записей.
- Lighthouse mobile по всем основным маршрутам на production.
- Создание первого `owner` в production (скрипт, без хранения пароля в репозитории).

## Что не входит

Мониторинг сторонними платными сервисами без решения заказчика.

## Критерии готовности

1. Production открывается по домену, HTTPS, заголовки проверены (securityheaders.com уровень A или выше; e2e на заголовки зелёный).
2. Регион функций и БД совпадают (скриншот/вывод настроек в отчёте).
3. Бэкап отработал по расписанию хотя бы раз, файл зашифрован.
4. Восстановление проведено, результат записан в runbook.
5. Lighthouse mobile production: Performance 90+, Accessibility 95+, Best Practices 95+ на `/login`, `/today`, `/clients`.
6. Секретов нет в репозитории и клиентском бандле.
7. Стоимость инфраструктуры сообщена заказчику (D-06 закрыт).

## Чек-лист

Часть 1, в репозитории (PR этого шага):

- [x] Заголовки: CSP с nonce на каждый запрос (`src/proxy.ts`, `src/lib/security-headers.ts`), HSTS, `X-Frame-Options: DENY`, `X-Content-Type-Options`, `Referrer-Policy`, `Permissions-Policy`, COOP; unit-тесты и e2e `security-headers.spec.ts` (заголовки, свежий nonce, ноль нарушений CSP на основных экранах и на 403)
- [x] Регион функций `fra1` в `vercel.json`, Git-деплой `main` выключен (production только из CI)
- [x] CI-деплой: `.github/workflows/deploy.yml` (после зелёного CI на `main`: `supabase db push`, затем `vercel deploy --prebuilt --prod`), выключен до D-06
- [x] Бэкап: `.github/workflows/backup.yml` (ежедневно, `pg_dump` → проверка восстановления → `age` → артефакт 30 дней, issue при падении), `scripts/backup/*`, выключен до D-06
- [x] Создание первого `owner`: `pnpm owner:create` (приглашение письмом, без пароля), функция `bootstrap_owner` только для `service_role` и только при пустой `staff`; интеграционные тесты
- [x] `docs/runbook.md`: первый запуск (Supabase Auth: signup выключен, Site URL, redirect `<домен>/auth/confirm`, шаблоны recovery и invite, SMTP), восстановление, ротация, утечка, контакты
- [x] Проверка восстановления: репетиция на локальном Supabase, результат в runbook
- [x] `/security-review`

Часть 2, после решения D-06 (новый PR в рамках этого шага):

- [ ] Supabase production (`eu-central-1`) и настройки Auth по runbook 2.1
- [ ] Vercel-проект, env production и preview, `PRODUCTION_ENABLED=true`
- [ ] Домен, HTTPS, редирект `www`
- [ ] Первый бэкап по расписанию, восстановление в отдельный проект, запись в runbook
- [ ] securityheaders.com уровень A или выше, Lighthouse mobile на production
- [ ] Стоимость инфраструктуры сообщена заказчику, D-06 закрыт
- [ ] PR, CI зелёный, отчёт

## Результаты части 1

- `pnpm check` зелёный: unit 573, интеграция 487, e2e 158 (mobile, desktop, global-settings).
- Lighthouse mobile, локальная production-сборка, `simulate`: `/login` Perf 99 / A11y 100 / BP 100, LCP 2,0 с; `/today` 95 / 100 / 100, LCP 3,0 с; `/clients` 94 / 100 / 100, LCP 3,0 с. CLS 0, нарушений CSP и ошибок консоли нет. До шага: `/login` 98, LCP 2,2 с; экраны за входом LCP 2,9–3,0 с, то есть отказ от PPR скорость не ухудшил.
- JS первой загрузки 141,6–148,7 КБ gzip на всех маршрутах.

## Заметки на будущее

- CSP с nonce несовместим с PPR: скрипты статической оболочки пререндерятся без nonce, и браузер их блокирует (проверено: на `/today` 16 из 29 скриптов без nonce). Поэтому `cacheComponents` и `partialPrefetching` выключены, корневой layout вызывает `connection()`, все страницы рендерятся на запрос. Цена небольшая: proxy и так ходит в БД на каждый запрос (сессия, роль). JS первой загрузки не изменился (141–149 КБ). Замерить LCP на Vercel в части 2; если оболочка станет заметно медленнее, вариант на будущее: хэши вместо nonce, когда Next научится хэшировать inline-скрипты RSC.
- `style-src 'self' 'unsafe-inline'`: sonner вставляет `<style>` во время работы, React и Radix пишут атрибуты `style`; nonce в `style-src` отключил бы `unsafe-inline`. Скрипты строго по nonce, инъекция CSS не исполняет код.
- Inline-скрипт темы в корневом layout разрешён по sha256-хэшу (считается в proxy из `themeInitScript`), чтобы layout не читал заголовки.
- Тест темы в `layout.spec.ts` вставляет свой скрипт с nonce из заголовка ответа: без nonce CSP его правильно блокирует.
- GitHub Actions не запускался из-за биллинга аккаунта (на PR #12): проверить перед закрытием части 1.
