# PHASE 1 — отчёт

Дата проверки: 8 сентября 2026 года. Следующая фаза не запускалась.

## Сделано

Изучен и сохранён foundation PHASE 0: workspace, Next.js, NestJS, strict TypeScript, Docker, PostgreSQL/PostGIS/pg_trgm, validation, errors, logging и прежние тесты. Реализованы seller signup/login/logout, server-side opaque sessions, rotation, отзыв одной/всех сессий и password reset architecture. Добавлены общий tenant authorization layer, роли и минимальные private shop/member endpoints для проверки границ доступа. Frontend не изменялся; каталог, товары, подписки, платежи и публичные страницы не создавались.

## Изменённые файлы

- `apps/api/src/db/schema.ts`, `apps/api/drizzle/*`, `apps/api/drizzle.config.ts`: schema и две migrations.
- `apps/api/src/db/migrate*.ts`, `cleanup*.ts`: migration runner и ограниченная очистка expired security records.
- `apps/api/src/auth/*`: credentials, sessions, cookies, CSRF, rate limiting, reset delivery boundary.
- `apps/api/src/authorization/*`, `apps/api/src/shops/*`: permission matrix, transactional tenant authorization, private shop/member API.
- `apps/api/src/app.module.ts`, `config.ts`, `database.ts`, `http.ts`, `health.controller.ts`: подключение auth и конфигурации без перестройки foundation.
- `apps/api/test/auth.unit.test.ts`, `auth.integration.test.ts`, существующие config/HTTP tests; `scripts/production-smoke.test.mjs`.
- Root/API package manifests, pnpm lock/workspace, API tsconfig, safe env examples, Dockerfile, compose.yaml, CI workflow.
- `README.md`, `docs/phase-1-architecture.md`, этот отчёт.

## Database

Созданы `users`, `sessions`, `shops`, `shop_members`, `password_reset_tokens`, `auth_rate_limits`; role/status enums, FK, unique/partial indexes, CHECK constraints, timestamptz, updated_at triggers. Deferred constraints гарантируют ровно одного owner у существующего shop. Plaintext session/reset tokens не хранятся.

Обе migrations успешно применены к локальным `qrg_market` и `qrg_market_test`. Повторное и конкурентное применение проверено; в обоих ledger по 2 записи. Docker migrate service завершился с exit 0. После integration tests в тестовой БД осталось 0 users и 0 shops; локальная основная БД также без fixture users/shops. Данные очищались адресно, без удаления volumes или пользовательских таблиц.

## Security

Проверены Argon2id, SHA-256 token storage, cookie flags, CSRF/Origin/custom header/JSON, session fixation, rotation/revoke/reset races и replay, account enumeration по response, brute-force limits, spoofed forwarded headers, disabled/expired sessions, strict DTO validation и mass assignment. IDOR/BOLA tests проверяют замену shop ID в URL/body/query, member ID, session ID и horizontal privilege escalation. Permissions вычисляются из актуального membership в БД, повторно проверяются внутри транзакции.

`pnpm audit --prod --audit-level=high`: известных уязвимостей не найдено. Не проводился внешний penetration test; успешные automated tests не являются его заменой.

## Tests

- `pnpm test` / `pnpm test:critical`: 13/13 успешно; прежние PHASE 0 checks сохранены.
- `pnpm test:db`: 30/30 успешно на реальной PostgreSQL, без skipped tests.
- `pnpm test:smoke`: 2/2 успешно на production artifacts.
- Всего 45 различных проверок. Дополнительно: Docker runtime readiness 200, private shops без cookie 401, OpenAPI содержит новые routes, web 200.

## Typecheck

`pnpm typecheck`: успешно для API и web, strict TypeScript сохранён.

## Lint

`pnpm lint`: ESLint без предупреждений, Prettier check успешно.

## Production Build

`pnpm build`: успешно для API и web. Docker production targets `api` и `web` собраны, включая native Argon2. Локальные контейнеры запущены; API/DB healthy, web доступен. Compose использует development API config с локальной БД без TLS — это проверка образов, не production deployment.

## Известные проблемы

- Email delivery provider/credentials не выбраны. Reset request возвращает явную 503 до настройки настоящего adapter; hash/expiry/confirmation/revoke flow проверен через test-only delivery adapter.
- GitHub remote отсутствует: workflow обновлён и его проверки выполнены локально, но remote CI/required checks не проверены.
- До production необходимо настроить trusted proxy boundary (сейчас IP limit использует socket IP), периодический cleanup, отдельные DB roles и инфраструктуру/backup/restore в Казахстане. Это не выполненный production deployment.

## Технический долг

Функциональные обходы security checks, mocks в production и отключения тестов не добавлялись. Drizzle Kit использует два deprecated upstream dev-only пакета `@esbuild-kit/core-utils` и `@esbuild-kit/esm-loader`; это ограничение текущего migration tooling, не production dependency. Следить за обновлением upstream, не обходить его принудительными несовместимыми overrides.

## Следующая рекомендуемая фаза

PHASE 2 — только после отдельной команды пользователя и получения её точного scope. Автоматический переход не выполнен.
