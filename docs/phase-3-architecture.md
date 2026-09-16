# PHASE 3 — каталог, поиск и 2GIS

## Границы

Modular monolith, pnpm, Next App Router → Nest REST → PostgreSQL/Drizzle сохранены. Новых прямых dependencies, packages, WMS, Redis, OpenSearch, платежей или кабинетов нет. Существующая дизайн-система расширена через sites-building; перенос на Cloudflare/Sites не выполнялся, поскольку противоречил бы заданной архитектуре и границам фазы.

## Данные и публикация

Миграция 0002 добавляет categories (категория + подкатегория), brands, products, product_variants, product_images, shop_locations, shop_contacts. В shops добавлены уникальный slug и description; существующие строки получают технический slug с UUID, без изменения статуса.

Категории и бренды — общий управляемый справочник. В migration есть пять базовых категорий, но нет вымышленных бутиков, товаров, покупателей или продаж. Изменение справочника сейчас выполняется доверенным оператором БД; публичного/admin CRUD не добавлено. Массовые импорты следует выполнять транзакционно, с последующей проверкой search_text; обход API должен учитывать те же ограничения и конкурентные обновления справочников.

Product: UUID, shop/category FK, nullable brand FK, name, slug, description, numeric(12,2) base_price/old_price, DRAFT/PUBLISHED/ARCHIVED, timestamps. Variant: составной FK (product_id, shop_id), nullable size/color/SKU/override, boolean availability, timestamps. SKU уникален внутри магазина, сочетание size/color — внутри товара. API ограничивает товар 100 вариантами; create product + variants атомарен.

Цены в KZT; до двух десятичных знаков, от 0 до 99 999 999,99. old_price должен быть больше base_price. Фильтры размера/цвета/наличия/цены/скидки должны выполняться на **одном** варианте. Выводимая цена и сортировка — минимальная эффективная цена подходящих вариантов, где effective = override ?? base_price. На detail старую цену показываем только если она больше выбранной. Никаких резервов и транзакционного складского учёта.

Публичный доступ: products.status=PUBLISHED AND shops.status=ACTIVE. Скрытие применяется к каталогу, detail, поиску, подсказкам, shop pages и facets. Приостановка не удаляет данные. Seller API не позволяет менять статус магазина, role/owner или произвольно активировать витрину. Верификация/подписка остаются отдельными фазами.

FK удаления: shop → products/location/contacts CASCADE; product → variants/images CASCADE; category/brand references RESTRICT. CHECK: цены, длины, slug, координатная пара/диапазон, link/id consistency, image dimensions/key/position. Триггеры поддерживают updated_at и search_text; generated search_vector обновляется PostgreSQL.

## REST /api/v1

Публичные GET:

- /public/categories — справочник до 1000 записей, включая parentId.
- /public/brands — id/name/slug, page/limit.
- /public/catalog — items,total,page,pages,limit.
- /public/products/:slug — опубликованный товар, варианты, image metadata, публичные данные магазина.
- /public/shops — page/limit, только ACTIVE.
- /public/shops/:slug и /public/shops/:slug/products.
- /public/filters — значения фасетов только публичных предложений.
- /public/search/suggestions?q=... — максимум 8 slug/name, запрос 2–100 символов.

Catalog filters: q, category/subcategory (slug), brand (имя из справочника), shop (slug), mall, size, color, priceMin/priceMax, availability=available, discount=true. sort: new, price-asc, price-desc; без sort при поиске — FTS rank/trigram relevance. page 1–1000, limit 1–100, по умолчанию 8. Стабильный tie-breaker по UUID. Count/items читаются в одном repeatable-read snapshot.

Закрытые операции:

- GET/POST /shops/:shopId/products.
- GET/PUT /shops/:shopId/products/:productId.
- POST /shops/:shopId/products/:productId/variants.
- PUT /shops/:shopId/products/:productId/variants/:variantId.
- PUT /shops/:shopId/location и /shops/:shopId/contacts.

PUT product принимает полные поля товара, не массив variants; варианты обновляются отдельным endpoint. Безопасное архивирование — status=ARCHIVED. DELETE намеренно не добавлен. Закрытый список поддерживает page/limit; публичные поисковые фильтры применяются в public/catalog.

SHOP_OWNER/MANAGER/EMPLOYEE могут управлять товарами своего магазина. Location/contacts — только owner (shop.settings.write). Session/CSRF/Origin/JSON guards PHASE 1 и global whitelist+forbidNonWhitelisted действуют на новых маршрутах. Все операции идут через ShopAuthorization.withShop с повторной проверкой membership под блокировкой. productId/variantId дополнительно привязаны к проверенному shopId. Присланные role/permissions/owner_id/shop_id отклоняются. Swagger доступен только в development по существующему адресу /api/docs.

## Поиск и индексы

search_text содержит product name/description, category/parent category, brand, shop. BEFORE product trigger формирует его; AFTER name updates справочников/магазина обновляют связанные товары. API держит shared locks на справочниках до commit записи товара, чтобы конкурентное переименование не оставляло устаревший search document.

Generated tsvector объединяет russian и simple конфигурации; GIN products_fts_idx. pg_trgm GIN products_trgm_idx поддерживает word-similarity и буквальный ILIKE, wildcard-параметры экранируются. Запросы параметризованы, SQL/sort не составляется из пользовательского текста. Есть B-tree индексы slug, FK, shop/date, public price/date и variant filters. В тестах проверены русский stemming, опечатка и доступность GIN-плана; это не нагрузочный benchmark. PostgreSQL statement_timeout=5s ограничивает запросы. Производственный edge rate limiting и профиль нагрузки проверяются перед запуском; Redis не добавлен.

Официальные основания: [PostgreSQL FTS tables/indexes](https://www.postgresql.org/docs/17/textsearch-tables.html), [pg_trgm operators/indexes](https://www.postgresql.org/docs/17/pgtrgm.html).

## 2GIS и PostGIS

Узкий подтверждённый формат: https://2gis.kz/karaganda/firm/ID, ID из 10–20 цифр. Допустим один trailing slash, удаляемый при нормализации. firm ID выводится из URL; явно заданный ID обязан совпасть. Пример формата проверен по [официальной карточке 2GIS](https://2gis.kz/karaganda/firm/70000001038483747).

HTTP, credentials, порты, suffix/Unicode domains, короткие ссылки, произвольные города/пути, query/hash, encoded paths и редиректы запрещены. Это намеренно не универсальный парсер всех форматов 2GIS. Для других форматов allowlist расширяется только после проверки официальных источников и тестов. Сервис не скачивает seller URL, не следует редиректам, не делает SSRF-запросов и не использует платный Places API.

Проверка выполняется server-side, дублируется CHECK в БД и защитой href на frontend. Кнопка использует target=_blank с noopener/noreferrer. Без URL кнопка недоступна. Проверка формата **не доказывает принадлежность** карточки продавцу — это задача верификации магазина.

lat/lon nullable, только парой; geometry(Point,4326) generated, GiST locations_geo_idx. PostGIS и pg_trgm включены migration. Nearby-search не реализован. Телефоны нормализуются в E.164; WhatsApp flow не добавлен этой фазой.

## Изображения

product_images содержит только metadata и безопасный object_key, не binary/внешний seller URL. Уникальные позиции 0–9 обеспечивают максимум 10 фото. Размеры 1–12000, alt до 300. Только products/product-UUID/random-UUID.webp или .avif; путь должен соответствовать product_id.

QRG_MEDIA_ORIGIN — доверенный HTTPS S3/CDN origin, конфигурируется при build и runtime. Next Image разрешает только /products/** на этом origin. UI показывает галерею обработанных объектов. Без фото/конфигурации выводит «Фото пока не добавлено», не подменяет изображение товара демонстрационной фотографией.

Dockerfile принимает build ARG QRG_MEDIA_ORIGIN; Compose передаёт одно значение в build/runtime. Это публичный origin, не credential.

Upload endpoint отсутствует до внедрения полного decode/EXIF/resize/format/10 MB pipeline. Seller не может сам прислать object key. Схема и read API готовы для проверенного media pipeline следующей соответствующей фазы; это не фиктивная production загрузка.

## Frontend и эксплуатация

QRG_API_ORIGIN только server-side, origin без credentials/path/query/hash. Server adapter передаёт только публичные GET, без buyer/session cookies, с no-store, запретом redirects и timeout 8s. При ошибке настоящего API используется error boundary, не fixtures. Полный каталог в браузер не загружается: pagination выполняет PostgreSQL.

Fixtures разрешены только при NODE_ENV=development + QRG_DEV_FIXTURES=true. В production флаг игнорируется. API records проверяются на границе, HTML выводится React escaping, ссылки строятся из безопасных slug.

Autocomplete: debounce 250ms, AbortController, отбрасывание устаревших результатов, ARIA combobox/listbox, ArrowUp/Down/Enter/Escape, сообщения загрузки/ошибки/no-results. Без JS GET-форма поиска и фильтров сохраняет работоспособность. Измерение пользовательской популярности пока отсутствует: live homepage честно использует заголовки «Бутики Караганды» / «Товары бутиков».

noindex/robots launch gate сохранён до отдельного публичного запуска; schema.org рейтинги/продажи не выдуманы. KZ production infrastructure, backups, полноценная moderation, reset email delivery и публичный запуск остаются вне этой фазы. Для проверки используйте выделенную *_test БД; fixtures удаляются адресно, без TRUNCATE.

## Исправление найденной зависимости

Audit 9 сентября обнаружил 3 high + 1 low в Multer 2.2.0, жёстко закреплённом в актуальном @nestjs/platform-express 12.0.1. В pnpm-workspace.yaml добавлен узкий override @nestjs/platform-express@12.0.1>multer → 2.3.0, lockfile обновлён. Исправленная версия опубликована 28 августа, minimumReleaseAge и остальные supply-chain checks не отключались.

Основание: [официальный advisory Multer](https://github.com/expressjs/multer/security/advisories/GHSA-wc9g-mqfw-jrwm), [релиз 2.3.0](https://github.com/expressjs/multer/releases/tag/v2.3.0). После изменения audit не обнаруживает известных уязвимостей. Upload interceptor не подключён; это исправление транзитивной зависимости, а не реализация загрузки. Override нужно удалить после проверенного обновления upstream Nest pin — явно учтённый технический долг.
