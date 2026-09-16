# QRG MARKET

PHASE 7B выполнена частично: добавлены Halyk adapter, реальный OAuth/status-клиент, постоянные invoice bindings и низкоуровневые запросы для hosted checkout / оплаты по CardID по официальной документации. Новые wire contracts проверены только offline. Пользовательский checkout, recurring и callback-активация **не подключены**: отсутствуют merchant credentials/settings и спецификация требуемой подписи callback. Даже настройка credentials не включает списания. См. [payment security audit и условия продолжения](docs/phase-7b-payment-audit.md). Внутренняя логика подписки PHASE 7 и foundation PHASE 0–6 сохранены. QRG не принимает оплату покупателя; заявка не является платёжным заказом.

Административный вход: `/admin/login`. Администраторы не создаются автоматически и не назначаются через seller API. Перед первым входом оператор настраивает ключ MFA и выдаёт доступ существующему пользователю по [инструкции PHASE 6](docs/phase-6-architecture.md). Теперь публикация требует и модерации, и subscription entitlement. Оплата не снимает административную блокировку. Без подключённого provider продление через UI недоступно и API возвращает 503.

## Стек и структура

- Node.js 24.20.0 LTS, pnpm 11.26.0, TypeScript 6.0.3 strict.
- `apps/web`: Next.js 16.3.4 App Router, React 19.2.8, Server Components.
- `apps/api`: NestJS 12.0.1, REST `/api/v1`, Drizzle, PostgreSQL.
- PostgreSQL 17.11 + стабильный PostGIS из PGDG + pg_trgm.
- ESLint 10, Prettier, Node.js test runner, GitHub Actions.
- Общие workspace packages пока не нужны: UI-компоненты переиспользуются внутри `apps/web/components`, без отдельного package с единственным потребителем.

Frontend не подключается к PostgreSQL. Next.js обращается к NestJS через серверный адаптер. Подсказки идут через узкий Next route handler. API не включает CORS для прямых браузерных запросов между origin.

## Публичный интерфейс и demo preview

Для реальных данных задайте серверный QRG_API_ORIGIN (в Docker Compose уже настроен). Только PUBLISHED товары ACTIVE магазинов доступны публично. Без предложений показывается empty state; без QRG_API_ORIGIN — сообщение о подготовке витрины. Ошибка настроенного API не подменяется fixtures. Для отдельного development-only preview:

```powershell
$env:QRG_DEV_FIXTURES = 'true'
pnpm --filter @qrg/web dev --port 3002 --hostname 127.0.0.1
```

Откройте `http://127.0.0.1:3002`. Примеры detail routes: `/product/demo-sand-coat`, `/shop/demo-atelier`. API и БД для этого preview не нужны. В `NODE_ENV=production` fixtures отключены безусловно, даже при `QRG_DEV_FIXTURES=true`; это проверяется production smoke test.

Все demo данные помечены, не пишутся в БД и не содержат действующих контактов. Формы поиска/фильтров используют GET и URL; заявки/WhatsApp/2GIS в demo неактивны с пояснением. Подробнее: [PHASE 2 architecture](docs/phase-2-architecture.md), [источники фото](docs/fixture-photo-sources.md).

`QRG_SITE_URL` — необязательный доверенный HTTPS origin для canonical/OG URL, без credentials/path/query. Не берётся из Host/X-Forwarded-Host. До отдельного публичного запуска сохраняется noindex и закрытый robots. QRG_MEDIA_ORIGIN на build/runtime задаёт доверенный HTTPS origin обработанных S3-фотографий; без него фото не подменяются иллюстрациями. Загрузка продавцом реализована в PHASE 4.

## Быстрый старт

Установите Node.js из `.node-version`, pnpm версии из `packageManager` и Docker с Linux containers. На Windows команды ниже выполняются из корня проекта в PowerShell.

```powershell
Copy-Item .env.example .env
Copy-Item apps/api/.env.example apps/api/.env
Copy-Item apps/api/.env.test.example apps/api/.env.test
Copy-Item apps/web/.env.example apps/web/.env.local
pnpm install --frozen-lockfile
docker compose -f compose.yaml -f compose.host.yaml up -d --build --wait db
pnpm db:migrate
pnpm dev
```

Примеры паролей предназначены только для локальных данных. При изменении локального пароля согласуйте `.env`, `apps/api/.env` и `apps/api/.env.test`. Пароль в DATABASE_URL должен быть URL-encoded; для Compose-примера используйте URL-safe пароль.

- Web: `http://localhost:3000`.
- API liveness: `http://localhost:3001/api/v1/health` — работает без БД.
- API readiness: `http://localhost:3001/api/v1/health/ready` — реальный `SELECT 1`; 503 при недоступности БД.
- Swagger UI: `http://localhost:3001/api/docs`.
- OpenAPI JSON: `http://localhost:3001/api/openapi.json`.

`pnpm dev` запускает оба приложения; API перекомпилируется через tsc-watch с поддержкой decorator metadata. Next.js не требует работающей БД для сборки.

На текущем компьютере проверки выполнены через локальные Node/pnpm в игнорируемой `.tools`, без изменения системных установок. Для их использования в текущем PowerShell-сеансе:

```powershell
$env:PATH = "$PWD\.tools\node-v24.20.0-win-x64;$PWD\.tools\pnpm11\node_modules\.bin;" + $env:PATH
node --version
pnpm --version
```

Эта папка не входит в git; на другом компьютере инструменты устанавливаются обычным способом. Если Docker-приложения уже запущены, перед `pnpm dev` остановите сервисы `web` и `api`, чтобы освободить порты 3000/3001.

## Docker

```powershell
# Собрать и запустить все приложения (локальная конфигурация).
docker compose --profile app up -d --build --wait
# Остановить, сохранив данные.
docker compose --profile app down
```

В базовом Compose PostgreSQL не публикует порт и находится во внутренней сети. Только `compose.host.yaml` открывает `127.0.0.1:5432` для разработки с host. Web и API публикуются только на loopback. Образы приложений выполняются от non-root пользователя. API имеет read-only filesystem, dropped capabilities и no-new-privileges.

Dockerfile содержит production targets `api` и `web`. Compose запускает скомпилированный API в **development-конфигурации**, поскольку локальная БД не настроена на TLS. Это не production deployment. Для настоящего production обязательны секреты извне, private PostgreSQL, проверяемый TLS, регион Казахстана и проверенные backup/restore. Образ БД и init.sql предназначены для local/CI; production-приложение не должно использовать DB superuser.

`infra/postgres/init.sql` выполняется только на новом volume, создаёт расширения и отдельную тестовую БД. При изменении init.sql существующие данные не пересоздаются автоматически. Не удаляйте volume ради применения изменений.

Сервис `migrate` применяет SQL migrations перед запуском API; API стартует только после его успешного завершения. Повторный запуск безопасен: миграции учитываются в ledger и сериализуются advisory lock. Миграции включены в API image.

## Конфигурация API

| Переменная               | Поведение                                                                                                     |
| ------------------------ | ------------------------------------------------------------------------------------------------------------- |
| `NODE_ENV`               | `development`, `test` или `production`; по умолчанию development                                              |
| `PORT`                   | Целое 1–65535; по умолчанию 3001                                                                              |
| `DATABASE_URL`           | Обязательный PostgreSQL URL с user/host/database; query/hash запрещены                                        |
| `DATABASE_SSL`           | Только true/false; в production обязательно true, проверка сертификата включена                               |
| `SWAGGER_ENABLED`        | По умолчанию true только в development; в production разрешено только false                                   |
| `APP_ORIGIN`             | Origin браузерного приложения; development/test: http://localhost:3000; production: обязательный HTTPS origin |
| `AUTH_RATE_LIMIT_SECRET` | Секрет HMAC для обезличенных rate-limit ключей; production: обязательный случайный секрет 32–128 символов     |
| `NODE_EXTRA_CA_CERTS`    | Стандартная переменная Node.js для доверенного private CA при необходимости                                   |

`.env` API загружается только development-командой; `.env.test` — DB-тестом. `start` ожидает переменные окружения от инфраструктуры. Конфигурация проверяется до создания приложения; неправильные значения останавливают запуск. Production-пример не содержит рабочих credentials.

Ошибки API имеют поля `statusCode`, `code`, `message`, `requestId`, `timestamp`. В ответах не возвращаются exception messages, stack traces, входные значения или SQL. `x-request-id` генерируется сервером, переданный клиентом идентификатор не используется. Structured logs содержат событие, request_id, метод, status и длительность, без URL/query, body, IP, cookies или authorization headers. Валидация DTO глобальная; лишние поля отвергаются. JSON payload ограничен 32 KiB, гостевая заявка — 8 KiB. Uploads имеют отдельный лимит 10 MiB и проверку прав до разбора multipart.

## Проверки

```powershell
pnpm typecheck
pnpm lint
pnpm test
pnpm test:db
pnpm build
pnpm test:smoke
pnpm test:web:preview
pnpm audit --prod --audit-level=high
```

- `pnpm test`: 22 API unit/config/HTTP и 17 web unit проверок. Web tests используют native Node.js TypeScript support, без нового test framework.
- `pnpm test:critical`: алиас текущего critical набора `pnpm test`; прежние проверки PHASE 0 сохранены. Security DB tests отдельно обязательны в CI.
- `pnpm test:db`: 43 проверки на реальном PostgreSQL: миграции, constraints, authentication, sessions, password reset, CSRF, rate limits, каталог и IDOR/BOLA. Требует отдельную БД с суффиксом `_test`; не пропускается при отсутствии БД/конфигурации. Тестовые данные очищаются адресно, без TRUNCATE.
- `pnpm test:smoke`: после build запускает compiled API и production Next.js, проверяет SSR/headers/health и скрытие Swagger. Использует loopback-порты 43180/43181.
- `pnpm test:web:preview`: 8 HTTP integration tests development-витрины, включая все маршруты, URL filters, 404, image optimizer и SEO. Сам запускает/останавливает Next dev на 43182; другой Next dev того же проекта предварительно нужно остановить. Для уже запущенного preview на 3002 установите `QRG_PREVIEW_TEST_URL=http://127.0.0.1:3002`; тесты не останавливают переиспользованный сервер. Это HTTP-тесты, не browser interaction/a11y audit.
- `pnpm format`: форматирование; `lint` также проверяет Prettier.

CI выполняет typecheck, lint, тесты, миграции, реальную DB-проверку, build, smoke, production dependency audit и сборки Docker. Deploy workflow намеренно отсутствует. Непрошедший quality job блокирует дальнейший pipeline; required branch checks нужно включить в GitHub после создания remote.

## Authentication и database operations

Контракты API, permissions, CSRF и эксплуатационные ограничения описаны в [архитектуре PHASE 1](docs/phase-1-architecture.md).

- `pnpm db:generate` генерирует migration из Drizzle schema; SQL требуется проверить до применения.
- `pnpm db:migrate` применяет недостающие migrations к `DATABASE_URL` из environment или `apps/api/.env`.
- `pnpm db:cleanup` удаляет ограниченную порцию просроченных session/reset/rate-limit записей. Политика хранения и организация периодического запуска описаны в архитектуре.

Password reset имеет одноразовые hashed tokens и transactional confirmation, но отправка письма намеренно не подключена: `/api/v1/auth/password-reset/request` возвращает 503 до настройки реального delivery adapter. Никаких токенов в логах или фиктивного production delivery нет. Provider выбирается отдельно и подключается по официальной документации.

## Решения по версиям

Версии проверены 8 сентября 2026 года. Next.js 16 соответствует [Active LTS policy](https://nextjs.org/support-policy). NestJS 12 поддерживает [используемый ESM/decorator workflow](https://docs.nestjs.com/migration-guide). PostgreSQL 17.11 включён в [актуальные security releases](https://www.postgresql.org/docs/release/).

TypeScript 6.0.3 выбран по peer compatibility typescript-eslint (TypeScript 7 пока за пределами его supported range). ESLint 10 использует официальные Next.js Core Web Vitals и React Hooks plugins напрямую: готовый eslint-config-next подтягивает React/import/a11y plugins с peer range только до ESLint 9. Это не отключает TypeScript, Next.js или Hooks checks; отдельного a11y lint plugin пока нет.

pnpm 11.26.0 — последний проверенный patch ветки 11. pnpm 12.3.4 был проверен, но в этой Windows-среде оставил broken lockfile и ссылки; foundation использует воспроизводимо проверенную ветку 11. Supply-chain настройки находятся в pnpm-workspace.yaml, включая 24h minimumReleaseAge, strict peers и явный allowBuilds. Телеметрический install script `@scarf/scarf` запрещён.

## Границы следующей работы

MASTER CONTEXT пользователя остаётся источником требований. Выполнены команды до PHASE 7 включительно. Реальный платёжный провайдер и production-инфраструктура Казахстана не подключаются автоматически. Ожидается отдельная команда PHASE 7B.

## Каталог PHASE 3

Контракты, правила цены/публикации, 2GIS, ограничения media и эксплуатация: [PHASE 3 architecture](docs/phase-3-architecture.md).

`pnpm test:catalog:smoke` запускается после `pnpm test:db` и `pnpm build` с DATABASE_URL выделенной *_test БД. Проверяет собранный Next.js через настоящий Nest/PostgreSQL, без подмены Products API (порт 43184). Полный отчёт: [PHASE 3 report](docs/phase-3-report.md).

# PHASE 4: кабинет продавца

Локальный кабинет: <http://localhost:3000/seller/login> после запуска Compose.
Настройки и ограничения: [архитектура PHASE 4](docs/phase-4-architecture.md).
Проверки и результаты: [отчёт PHASE 4](docs/phase-4-report.md).
Для host-run API используйте S3-параметры из `apps/api/.env.example`;
Compose настраивает local S3 автоматически. `pnpm media:cleanup` запускает
ограниченную очистку вручную; API также выполняет её раз в минуту.

## PHASE 5: заявки покупателей

«Заказать у продавца» на реальном опубликованном товаре открывает гостевую форму.
Заявки магазина доступны в `/seller/[shopId]/requests`; CONFIRMED означает только
подтверждение обращения. WhatsApp использует проверенный номер продавца и безопасный
`wa.me` draft link. Development fixtures не отправляют заявки.

`CUSTOMER_REQUESTS_ENABLED` в API: по умолчанию true в development/test,
false в production. До включения production владелец должен утвердить реквизиты
оператора, privacy-контакт, сроки хранения и размещение персональных данных в KZ.
`REQUEST_CAPTCHA_REQUIRED=true` блокирует отправку, пока не подключён реальный
CAPTCHA adapter; существующая защита не выдаётся за CAPTCHA.

Проверки с отдельной `_test` БД:

```powershell
pnpm test:requests
pnpm build
pnpm test:requests:smoke
```

Smoke использует порт 43186 и настоящий Nest/PostgreSQL. Полные контракты,
anti-spam ограничения и эксплуатация: [архитектура PHASE 5](docs/phase-5-architecture.md).
Результаты quality gate: [отчёт PHASE 5](docs/phase-5-report.md).

## PHASE 6: Admin Area и модерация

`/admin/login` → отдельная MFA-сессия → очередь `/admin/shops?status=PENDING_VERIFICATION` → карточка и история → решение. Журнал `/admin/audit` доступен только с отдельным разрешением. Продавец отправляет магазин на проверку в разделе «Магазин» своего кабинета и видит причину возврата/отказа. APPROVE оставляет магазин VERIFIED, не публикуя его.

```powershell
pnpm test:admin
# После production build:
pnpm test:admin:smoke
```

Обязательная настройка MFA, операторская выдача/отзыв ADMIN, permissions и ограничения: [архитектура PHASE 6](docs/phase-6-architecture.md). Quality gate: [отчёт PHASE 6](docs/phase-6-report.md).

## PHASE 7: внутренняя subscription logic

Владелец видит `/seller/[shopId]/subscription`: тариф 10 000 KZT, оплаченный период, следующую дату оплаты, grace, auto-renew/cancellation и историю попыток. Пока provider не подключён, оплата недоступна; создание записи не активирует доступ или trial.

```powershell
pnpm test:subscriptions
pnpm build
pnpm test:subscriptions:smoke
# Bounded maintenance deadlines, без банковских запросов:
pnpm billing:tick
```

`billing:tick` требует регулярного запуска при deployment. HTTP-публичность дополнительно проверяет срок подписки независимо от задержки job. При billing suspension проверенный shop возвращается в VERIFIED; административный SUSPENDED никогда не снимается оплатой.

[Архитектура и правила дат PHASE 7](docs/phase-7-architecture.md), [отчёт PHASE 7](docs/phase-7-report.md). Halyk не подключён. Следующий этап — только PHASE 7B по отдельной команде.
