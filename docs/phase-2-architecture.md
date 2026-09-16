# PHASE 2 — публичная витрина

## Границы

Существующие API, auth, tenant authorization, schema и migrations не изменены. Публичный UI расположен в `apps/web`, читает только отдельный catalogue repository. Он не обращается к private `/shops` PHASE 1 и не имеет доступа к PostgreSQL. Seller dashboard, платежи, реальные заявки и внешние контактные интеграции отсутствуют.

## Design system

Общая тема находится в `app/globals.css`: белая основа, graphite `#252522`, вторичный текст `#676760`, светлая поверхность `#f7f6f2`, песочный `#e9dfcc`, контрастный accent `#795f35`, radius 6px. Системная sans-serif typography без внешнего font request; fluid heading scale, единая ширина контента и отступы. Нет gradients, glassmorphism, декоративного неона, fake ratings или counters.

В `components/` созданы Header, Footer, ProductCard, ShopCard, CategoryCard, Button/ButtonLink, Input, Select, Badge, Skeleton, EmptyState, ErrorState, LoadingState, MobileDrawer и FilterUI/SortUI. Shared workspace package не нужен: потребитель один. Рекомендации sites-building применены к общей теме, композиции и доступности; его cloud scaffold/hosting не применялись, чтобы сохранить стек и scope проекта.

На телефоне: две колонки товаров, одноколоночные детали и магазины, меню и фильтры в drawer; на большом экране: расширенная сетка и sidebar. CSS предусматривает перестройку на 760/1000px, перенос элементов, minmax(0,1fr), ограниченные картинки и flex-wrap.

Accessibility foundation: lang=ru, landmarks, skip link, единственный h1 страницы, labels, native form controls, focus-visible, keyboard-operable select/details, semantic buttons vs links, alt, status/alert, reduced-motion. Drawer использует native dialog.showModal: modal focus containment/inert background и Escape обеспечиваются браузером; есть кнопка закрытия, восстановление фокуса и закрытие при переходе. Не является подтверждением WCAG compliance: browser keyboard/screen-reader и визуальная проверка реальных viewport в этой фазе не проводились.

## Data boundary

`lib/catalogue/model.ts`: DTO и pure функции фильтрации/URL. `fixtures.ts`: исключительно development records. `repository.ts`: server-only интерфейс CatalogueRepository для будущего Nest public API adapter. Режим включается только при `NODE_ENV=development` И `QRG_DEV_FIXTURES=true`. Production/test/неизвестный environment возвращает unavailable с пустыми массивами. Флаг не NEXT_PUBLIC и не передаётся браузеру. Fixtures не seed-ятся и никогда не используются как fallback при ошибке настоящего API.

`connection()` и request-scoped React cache предотвращают prerender фикстур и повторное чтение внутри одного server render. До подключения API production имеет настоящий UI, но честно показывает отсутствие предложений. Когда появится API, заменить repository, добавить runtime response validation и server-side pagination/filtering; не переносить всю production database в read() и не доверять неизвестным image/contact URLs.

Fixture shops имеют явно демонстрационные имена/локации, без телефонов/реальных адресов; ACTIVE — лишь тестовое поле для проверки visibility, не badge верификации. SUSPENDED fixture и его product исключены из lists и detail routes. У карточек есть метки demo, в layout постоянное предупреждение. Фото иллюстративные, лицензии/авторы зафиксированы отдельно. Реальные verified badges, отзывы, рейтинги, объёмы продаж и статистика популярности не выдуманы; секции популярного в preview — пример подборки.

## Routes и взаимодействия

- `/`: заданные headline/subtitle, GET search, категории, бутики, популярные товары, новинки, скидки, how-it-works и seller CTA. CTA открывает описание тарифа, не имитирует регистрацию или отправку заявки.
- `/catalog`: server-rendered результаты; category/subcategory/brand/price/size/color/availability/shop/mall/discount; сортировка и pagination. GET forms работают с URL. Применение фильтров/сортировки сбрасывает page, category tabs сбрасывают subcategory. Back/forward и прямые ссылки получают server state; формы remount по фильтрам.
- `/product/[slug]`: фото, price/old price, brand, variant select, наличие, описание, характеристики, seller и обязательный direct-payment disclaimer. Недоступные demo actions объяснены; ничего не отправляют.
- `/shop/[slug]`: обложка, текстовая монограмма (не выдуманный реальный logo), demo identity, описание, место для контактов/часов, товары, новинки и акции.

Поиск нормализует регистр и ищет по product/description/category/brand/shop в fixtures; это не PostgreSQL FTS или production search service. Query values ограничены; повторённые scalar значения и некорректные числа получают безопасные defaults. Все критерии variant должны совпасть на одном варианте. Страницы ограничены 8 товарами, page 1–1000; unknown filters дают empty state, а не снимают ограничения. Новинки и discounts определяются только данными fixture.

Unknown и inactive shop/product получают notFound и HTTP 404. Loading boundary размещён только у каталога: общий root loading начинал stream до обнаружения missing record, что меняло HTTP status на 200; это исправлено без ослабления теста. Error boundaries используют актуальный Next 16.3 retry callback и не показывают внутренние exception details.

## Rendering, security, SEO

Pages/layout/cards/search/filter forms — Server Components. Client islands только drawer, variant state и error recovery; нет Redux, клиентского catalogue fetch или полноценной SPA. Фотографии находятся в `public/dev-fixtures`, используют Next Image, sizes, фиксированные aspect ratios и lazy loading кроме основной фотографии. Они доступны как статические иллюстрации, но production routes не используют их как товарные предложения. Next remotePatterns не расширялись.

Metadata: individual title/description/OG text, доверенный QRG_SITE_URL для canonical, без Host-header inference; `noindex, nofollow` пока нет реальных данных. robots запрещает indexing, sitemap пустой. Demo Product/Offer/Review structured data не создаются. Разблокировка индексации и заполнение sitemap должны идти одновременно с подключением реального API, проверенных магазинов и production origin.

Пользовательские query strings рендерятся React с escaping. Никаких dangerouslySetInnerHTML, analytics trackers, localStorage с персональными данными, public secrets или действующих demo contacts. Existing security headers и private API guards сохранены.

## Проверки и дальнейшее подключение

10 pure web tests + 8 actual Next HTTP preview tests. Production smoke запускает server с намеренно включённым fixture flag и убеждается в отсутствии фикстур, 404 demo details и корректном canonical. Сохранены 13 API tests и 30 real PostgreSQL tests. CI запускает все наборы. Browser-level interactions, screenshot layouts и screen reader audit остаются отдельной проверкой перед публичным запуском.

Источники решений: установленные Next 16.3 docs в node_modules (включая сгенерированные самим Next AGENTS.md/CLAUDE.md), [Next connection](https://nextjs.org/docs/app/api-reference/functions/connection), [Next robots](https://nextjs.org/docs/app/api-reference/file-conventions/metadata/robots), [native dialog](https://developer.mozilla.org/en-US/docs/Web/HTML/Reference/Elements/dialog). Runtime dependencies не добавлены.
