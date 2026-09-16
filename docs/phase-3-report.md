# PHASE 3 — отчёт

Дата: 9 сентября 2026. Выполнен только scope PHASE 3; PHASE 4 не начиналась.

## Сделано

- Реальные database entities, seller product/variant API, публичный каталог, product/shop details, справочники и facets.
- Все запрошенные фильтры, server pagination/sorting, согласованная цена варианта, URL query synchronization.
- PostgreSQL FTS + pg_trgm, обновление search document при переименованиях, autocomplete/debounce/keyboard/no-results.
- Server-side 2GIS allowlist, canonical HTTPS link, согласование firm ID, защитные CHECK и frontend validation. Кнопки на обеих detail pages.
- Frontend переведён на server-only Nest adapter; fixtures остаются строго opt-in development и не подменяют сбои API. Отображение metadata фотографий/галереи подготовлено для processed S3 objects.
- PostGIS для будущего nearby, без геопоиска/WMS.
- Через sites-building сохранены существующие design tokens, компоненты, SSR и доступность. Публикация в Sites не выполнялась.
- Исправлен обнаруженный audit security issue транзитивного Multer: узкий override 2.3.0, без ослабления проверок.

## Изменённые файлы

Основные файлы:

- apps/api/src/db/schema.ts; apps/api/drizzle/0002_sticky_demogoblin.sql и meta.
- apps/api/src/catalogue/{dto,public.controller,public.service,seller.controller,seller.service,two-gis}.ts.
- apps/api/src/app.module.ts; apps/api/src/authorization/permissions.ts.
- apps/api/test/catalogue.unit.test.ts; catalogue.integration.test.ts; auth.integration.test.ts (число migrations).
- apps/web/lib/catalogue/{model,repository,contract,suggestions}.ts.
- apps/web/app/page.tsx; catalog/page.tsx; product/[slug]/page.tsx; shop/[slug]/page.tsx; layout.tsx; globals.css; api/search/route.ts.
- apps/web/components/{cards,filters,product-options,search,shell,two-gis-link}.tsx; apps/web/test/catalogue-api.test.ts; next.config.ts.
- Package scripts, scripts/catalogue-smoke.mjs, scripts/production-smoke.test.mjs, .github/workflows/ci.yml.
- Dockerfile, compose.yaml, apps/web/.env.example, README.md, docs/phase-3-architecture.md.
- pnpm-workspace.yaml и pnpm-lock.yaml — security override Multer.

## Database

Миграция 0002 применена к локальной qrg_market и отдельной qrg_market_test. Ledger содержит 3 миграции; повторный migrate идемпотентен. Drizzle generate: No schema changes.

Созданы categories, brands, products, product_variants, product_images, shop_locations, shop_contacts. shops расширена slug/description. FK/UNIQUE/CHECK, timestamps/triggers, GIN FTS/trigram, GiST geometry и B-tree indexes добавлены. PostGIS 3.6.4 и pg_trgm 1.6 подтверждены SQL-проверкой. В основной БД пять базовых категорий, товаров 0: вымышленные коммерческие данные не загружались. Тестовые records создаются только в *_test и очищаются адресно.

## Security

Проверены IDOR/BOLA, подмена shop/product/variant/member IDs, body mass assignment, staff roles и revoke membership, CSRF, транзакционный rollback, SQL injection, скрытие DRAFT/SUSPENDED, URL parser tricks/redirects/Unicode domains/encoded paths, неправильные координаты, cross-shop FK и ограничения image metadata. Существующие authentication/security tests сохранены.

Audit первоначально выявил 3 high + 1 low Multer; исправлено 2.3.0 по официальному advisory. Финальный pnpm audit --prod --audit-level=high: No known vulnerabilities found. Не добавлены payment APIs, secrets, сторонние redirects, ослабление validation или mocks production-функций.

## Tests

- pnpm test:critical / test: 30/30 (17 API + 13 web).
- pnpm test:db: 43/43, настоящая PostgreSQL, включая прежние 30 и новые 13.
- pnpm test:catalog:smoke: 14/14; повторяет 13 catalog checks и добавляет production Next → Nest → PostgreSQL SSR проверку.
- pnpm test:smoke: 2/2 на production artifacts.
- pnpm test:web:preview: 8/8, включая прежние SSR/filters/escaping/404/image optimization/SEO; использован существующий preview 3002.
- 84 различных теста, без skipped. Браузерные клики/screenshots/screen-reader QA не выполнялись и не выдаются за проверенные.

В процессе исправлены TypeScript/JSX ошибки, форматирование и некорректный тестовый PUT payload (содержал недопустимый variants и не доходил до проверки IDOR). Тест не ослаблен: теперь валидный чужой ресурс даёт 404. Первый запуск preview tests столкнулся с блокировкой второго Next dev; штатный reuse существующего сервера позволил пройти все тесты.

## Typecheck

pnpm typecheck: успешно, API + web, TypeScript strict сохранён.

## Lint

pnpm lint: ESLint и Prettier успешно; security validation, TypeScript и тесты не отключались.

## Production Build

pnpm build: успешно Nest + Next. Docker API/web build и локальный Compose startup проверены. Это локальные production artifacts, не deployment в Казахстане и не публикация сайта. Compose web использует реальный API origin; мигратор запускается до API.

## Известные проблемы

- В основной БД нет реальных предложений: витрина честно пустая. Магазины не активируются автоматически.
- Upload pipeline ещё не включён: есть безопасные metadata/read API, но нет seller upload. Нужны processed objects и доверенный media origin; фотографии товаров не выдумываются.
- Верификация принадлежности карточки 2GIS — задача модерации, а не проверки формата URL. Сейчас принимается только подтверждённый формат 2gis.kz/karaganda/firm/ID.
- Публичная индексация остаётся закрытой до launch gate. Заявки/WhatsApp flow, dashboard, moderation/activation, подписки и платежи — вне этой фазы. Прежние ограничения reset delivery и KZ production infrastructure сохраняются.
- GitHub remote отсутствует, удалённый CI не запускался; локальные команды из quality gate выполнены.

## Технический долг

- Временный узкий override Multer 2.3.0: удалить после проверки upstream Nest версии с исправленным pin.
- Для нового autocomplete ещё нет browser interaction/screen-reader automation; имеются unit state/contract и HTTP/SSR проверки. Перед публичным запуском нужен browser-level accessibility/performance audit.

## Следующая рекомендуемая фаза

PHASE 4 — только по отдельному заданию пользователя. Автоматический переход не выполнен.
