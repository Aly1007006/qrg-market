# PHASE 8 — отчёт, 15 сентября 2026

**Статус: реализована и проверена локально. Production deployment не выполнялся.**

## Сделано

- Добавлены SHOP_VIEW, PRODUCT_VIEW, WHATSAPP_CLICK, TWO_GIS_CLICK и CUSTOMER_REQUEST_CREATED. Favorites не реализован — соответствующего события нет.
- Отчёт продавца за последние 7/30/90 × 24 часа: пять счётчиков и десять самых просматриваемых товаров. Доступ SHOP_OWNER/SHOP_MANAGER через существующую проверку сессии и shop_members; SHOP_EMPLOYEE статистику не получает.
- Сбор просмотров после видимости страницы, а не SSR/prefetch; клики не блокируют переход. Учитываются DNT/GPC. Никаких cookies, постоянного visitor ID или произвольного metadata в событиях.
- Создание заявки учитывается AFTER INSERT триггером в той же транзакции. Повторная доставка/изменение статуса заявки не должны создавать новое событие. Исторические обращения не восстанавливаются задним числом.
- Добавлены SEO launch gate, canonical/OpenGraph, разбиение sitemap по 1000 публичных URL, noindex для query-каталога, JSON-LD Product/Store по данным API с экранированием `<`. Не добавлены вымышленные отзывы, рейтинг, наличие или оплаченные продажи.
- Исправлена отключённая кнопка WhatsApp реального магазина; исправлен alt обложки для реального магазина. Стиль PHASE 7C сохранён.

## Изменённые файлы

- API: `src/analytics/{controller,dto,service}.ts`, `src/app.module.ts`, `src/authorization/permissions.ts`, `src/db/{schema,cleanup}.ts`, `src/catalogue/public.{controller,service}.ts`.
- Миграция `apps/api/drizzle/0008_demonic_yellowjacket.sql`, snapshot и journal.
- Web: `components/analytics.tsx`, `components/seller/analytics.tsx`, `app/api/analytics/route.ts`, seller statistics route, product/shop pages, `components/{cards,product-options,two-gis-link}.tsx`, `lib/seller/boundary.ts`, root layout/styles.
- SEO: `apps/web/lib/seo.ts`, `app/{robots,sitemap}.ts`, `app/public-pages/sitemap.ts`, catalog metadata.
- Tests: `apps/api/test/analytics.integration.test.ts`, migration count в auth integration, `apps/web/test/analytics-seo.test.ts`; package scripts, CI, `.env.example`.

## Database

Миграция 0008 применена на локальных `qrg_market_test` и `qrg_market`. Повторяемость и конкурентная безопасность migrations проверены существующим integration suite. Ранее недоступный Docker восстановлен; factory reset и удаление volumes не выполнялись.

`analytics_events`: UUID id/event_id, type, shop_id, nullable product_id, server timestamp. FK магазина, составной FK product/shop, CHECK типов и связи ресурса, UNIQUE(type,event_id). Индексы shop/time/type, product/time, retention time. Новые поля PII отсутствуют.

Триггер `request_analytics_created` и функция `qrg_request_analytics` создают событие заявки. Очистка событий старше 100 дней добавлена в `pnpm db:cleanup`: пачки до 10000, SKIP LOCKED. Scheduler очистки должен регулярно выполнять существующую команду; сама фаза не создаёт production scheduler. Транзакционный rollback, повторный статус и retention проверены на PostgreSQL.

## Security

- DTO allowlist исключает customer request events из публичного API, клиентские shop_id, timestamp, phone и произвольные поля. Shop/product определяются сервером по публичному slug и текущей видимости/подписке.
- BFF ограничивает тело 1 KB, проверяет origin и JSON, не пересылает cookies/authorization/IP. API использует существующий limiter с HMAC ключами временных окон. Это не измерение уникальных людей и не гарантия защиты от распределённых ботов.
- Статистика изолирована существующим authorization layer; нет mutation API отчётов.
- 56 существующих API unit/security/contract tests прошли, включая offline Halyk gate. Реальных банковских операций не выполнялось; существующий NO-GO PHASE 7B не снят.
- IDOR/BOLA, конкурентный replay, транзакционный учёт заявок, retention, реальные contact events, BFF origin/payload/allowlist и live sitemap прошли новые integration tests. Составной FK отвергает чужой product/shop. Сессия сотрудника и отозванное членство не дают доступа к статистике.

## Tests

- `pnpm test`: PASS, 56 API + 26 web = 82.
- `pnpm test:web:preview`: PASS, 10 SSR/fixture/URL/image/SEO tests.
- `pnpm test:smoke`: PASS, 2 production smoke tests (health/startup без работающей БД и публичная оболочка без fixtures).
- `pnpm test:analytics`: PASS, 8 тестов, включая built Next + real Nest/PostgreSQL.
- `pnpm test:db`: PASS, 43; `test:payments`: PASS, 8; `test:subscriptions`: PASS, 12; `test:admin`: PASS, 13; `test:requests`: PASS, 10; `test:media`: PASS, 8.
- Built-web smoke: catalog PASS 14; seller PASS 9; requests PASS 11; admin PASS 14; subscriptions PASS 13. Эти suites повторяют свои integration tests и добавляют по одному SSR/BFF сценарию.
- Всего 201 различный тест с учётом повторений suites один раз. Исправлена тестовая 2GIS fixture: добавлен обязательный firm ID; production URL validation не ослаблялась.
- CI запускает analytics после production build, поскольку suite проверяет собранный Next. Для ручного mobile QA доступен test-only `QRG_ANALYTICS_QA=true`: удерживает одноразовый test server три минуты, затем штатно удаляет собственные fixtures. Production код не содержит этого режима.

## Typecheck

PASS после исправления теста environment configuration. TypeScript strict не ослаблялся.

## Lint

PASS ESLint и Prettier после исправления шести no-floating-promises в новых тестах. Тесты не удалялись, правила не отключались.

## Production Build

PASS Next.js и NestJS. Не является подтверждением реальных банковских операций или запуском production инфраструктуры.

## Performance / accessibility / UX audit

- В браузере проверены mobile viewport 390×844: Header, Homepage, Catalog, Filters, Product, Shop, seller/admin login. DOM document width/scrollWidth совпадают (375 px с полосой прокрутки, 390 px в modal). Горизонтальный scroll категорий локальный, не переполняет документ.
- Dialog filters имеет доступное имя, фокус при открытии на закрытии; Escape закрывает и возвращает фокус на «Фильтры». Native select вариантов управляется клавиатурой; статус меняется на «Нет в наличии».
- Обследованные изображения имеют alt; labels форм присутствуют в accessibility tree. SSR/escaping/native-control tests прошли. Полная сертификация WCAG, screen-reader и измеренный contrast audit не выполнены.
- Дополнительно проверен live мобильный кабинет: реальный вход, навигация, статистика, смена 7 → 90 дней через URL. Открытие Product Page увеличило PRODUCT_VIEW с 0 до 1 и добавило товар в popular products. CustomerRequest раскрывается, показывает подписанные поля/consent и получает действующий backend challenge; клиентские поля имеют высоту 46 px, шрифт 14 px. Document overflow отсутствует. Отправка заявки и авторизованный admin queue/history/audit проверены built-web integration smoke; ручная mobile admin-проверка ограничена login, без изменения административной логики.
- Public pages остаются Server Components; analytics — небольшие client islands. Изображения используют существующий resize/WebP pipeline и responsive loading; protected media не кэшируется image optimizer. Новых dependencies/infrastructure нет.
- Суммарные production assets `.next/static`: JS 636978 bytes (gzip 199128), CSS 40186 bytes (gzip 8832). Это все chunks сборки, не размер загрузки одного route и не измерение Core Web Vitals.
- Analytics report использует две aggregate queries, а не запрос на каждый товар. EXPLAIN ANALYZE/BUFFERS на таблице с 10000 дополнительными событиями: Index Only Scan `analytics_shop_time_idx`, execution 0.032–0.040 ms в локальном прогоне, 3 shared hit blocks. Это выборочный запрос небольшого магазина, не production load benchmark. FTS GIN eligibility и существование pg_trgm/PostGIS indexes также проверены.
- Public/seller API reads сохраняют no-store для своевременного скрытия suspended shops и защиты данных. Нет добавленного Redis/поискового сервера.
- SEO включается только `NODE_ENV=production`, `QRG_INDEXING_ENABLED=true`, настроенными `QRG_API_ORIGIN` и HTTPS `QRG_SITE_URL`. По умолчанию индексирование закрыто. Live sitemap/visibility regression прошёл с БД. Root sitemap сделан динамическим, чтобы startup configuration не оставляла закэшированный пустой список после build с выключенной индексацией.

## Известные проблемы

Блокер Docker снят. Известных проваленных проверок PHASE 8 не осталось. Реальный Halyk по-прежнему закрыт gate PHASE 7B; его включение и merchant verification не входили в PHASE 8. Перед публичным запуском нужны production-domain/config, KZ infrastructure и регулярный запуск cleanup. Field Core Web Vitals, нагрузка реального трафика и полноценная screen-reader/WCAG-сертификация не измерялись локальными тестами.

## Технический долг

Новые production mocks, отключённые проверки или инфраструктурные зависимости не добавлены. Статистика начинается с применения миграции; старые события не выдумываются. Публичные event counters ограничены rate limit, но не претендуют на anti-fraud/unique visitors; это явно указано продавцу.

## Следующая рекомендуемая фаза

PHASE 9 — только после отдельного задания пользователя. Не начата. Этот отчёт не снимает отдельный production NO-GO интеграции PHASE 7B.
