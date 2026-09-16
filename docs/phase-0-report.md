# PHASE 0 — отчёт

Дата: 2026-09-08. Исходная папка была пустой, существующих приложений, conventions, схемы и тестов не было.

## Сделано

Созданы pnpm monorepo, Next.js App Router, NestJS API `/api/v1`, strict TypeScript, ESLint/Prettier, локальная PostgreSQL/PostGIS, Drizzle-подключение, Docker production targets и GitHub Actions quality gate. Инициализирован локальный Git main; remote и commit не создавались.

API: liveness/readiness, Swagger/OpenAPI в development, единый JSON error envelope (включая malformed JSON, oversized payload, неизвестные URL), global DTO validation, проверяемые dev/test/prod configs, безопасные env-примеры, request_id и structured logs, graceful shutdown и ограниченный connection pool.

Web: серверная адаптивная заглушка на русском, базовые metadata/noindex и security headers. Бизнес-функции не создавались. Общие packages не потребовались. Ограничения проекта записаны в docs/project-constraints.md.

## Изменённые файлы

- Корень: package.json, pnpm-workspace.yaml, pnpm-lock.yaml, tsconfig.base.json, format/git/env configs.
- apps/api: src/config.ts, http.ts, database.ts, health.controller.ts, app.module.ts, main.ts; configs и tests.
- apps/web: app/layout.tsx, page.tsx, globals.css, next.config.ts; configs.
- Dockerfile, compose.yaml, compose.host.yaml, infra/postgres/Dockerfile, infra/postgres/init.sql.
- .github/workflows/ci.yml, scripts/production-smoke.test.mjs, README.md, docs/.

## Database

Проверены PostgreSQL 17.11 и PostGIS 3.6.4. Созданы local БД qrg_market и qrg_market_test, расширения postgis и pg_trgm. Присутствует служебная таблица расширения PostGIS spatial_ref_sys; бизнес-таблиц, бизнес-индексов и миграций приложения нет. Тестовая temporary table откатывается транзакцией.

## Security

Проверены запрет лишних DTO-полей/невалидных типов, 32 KiB payload limit, единый безопасный формат ошибок, отсутствие внутренних exception messages в ответах, серверный request_id, security headers, отказ от Swagger/непроверяемого DB TLS в production. Проверены non-root контейнеры, read-only API filesystem, dropped capabilities, loopback-only published ports, исключение env/build/runtime из git и Docker context. Production dependency audit: известных уязвимостей не найдено. Peer dependencies: конфликтов нет.

IDOR/auth/payment/upload security tests не применимы к PHASE 0: соответствующих бизнес-модулей и endpoints ещё нет.

## Tests

- pnpm test: 9/9 unit и HTTP integration tests, включая текущий critical набор.
- pnpm test:db: 1/1 на настоящей PostgreSQL, проверка расширений и Drizzle rollback.
- pnpm test:smoke: 2/2 с запуском production Next.js и compiled production API.
- Docker runtime: Web 200; API liveness, DB readiness и OpenAPI 200.
- Ранее существующих tests не было; тесты не удалялись и не пропускались.

## Typecheck

pnpm typecheck: оба приложения прошли.

## Lint

pnpm lint: ESLint и Prettier прошли без ошибок и предупреждений.

## Production Build

pnpm build: Next.js и NestJS прошли. Production Docker targets api/web успешно собраны на Linux и запущены с локальным Compose окружением; PostgreSQL image также собран и проверен.

## Известные проблемы

Блокирующих ошибок foundation не осталось. GitHub Actions workflow создан, но удалённый запуск не выполнялся — remote не подключён; required checks на стороне GitHub ещё не настроены. На текущем host используется локальный runtime из .tools, поскольку системные версии ниже зафиксированных требований; команды приведены в README.

## Технический долг

Созданного технического долга не выявлено. Отсутствующие бизнес-функции и production deployment вне объёма PHASE 0. Ограничения выбора совместимых версий инструментов документированы в README.

## Следующая рекомендуемая фаза

PHASE 1 — по отдельному заданию пользователя. Не запускалась.
