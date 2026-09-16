# PHASE 7C — PUBLIC UI DESIGN ALIGNMENT

14 сентября 2026. UI-фаза выполнена; PHASE 8 не начата. Это не разрешение на production-запуск платежей.

## Сделано

Публичный интерфейс приведён к композиции предоставленного PNG-референса: тёмная top bar, белый header с поиском, отдельная category navigation, широкий fashion hero, 11 компактных category tiles, 4 ShopCard и 8 ProductCard в desktop-ряду, тёмный SellerCTA. Белый/графитовый фон и приглушённый песочный accent, компактная sans-serif typography, умеренные radius и плотные отступы.

Использованы переиспользуемые компоненты и scoped CSS module. Каталог, страницы товара и магазина используют ту же визуальную систему. Server Components и существующие API contracts сохранены. Новых dependencies, workspace packages или бизнес-функций нет.

Мобильная версия проверена при viewport 390×844, desktop — 1312×1200. На мобильном: поиск, горизонтальная навигация, две колонки товаров и bottom sheet фильтров. Проверены keyboard autocomplete → product page и применение фильтра → URL. Переполнения документа на проверенных мобильных страницах нет: clientWidth = scrollWidth = 375 (с учётом scrollbar).

Новые поступления и скидки сохранены в раскрываемой секции, чтобы основная композиция оставалась компактной. «Как работает QRG» находится отдельной видимой секцией после CTA: ссылка из footer работает без скрытого содержимого. Юридический footer и явная маркировка demo сохранены, хотя их нет на референсе. Нельзя принимать демонстрационные цены, магазины и фото за реальные предложения.

Для fashion banner, category art и demo-карточек использован skill imagegen, встроенная генерация растровых изображений. Assets находятся в workspace; [точные prompts и пути](phase-7c-assets.md). У реальных товаров не подменяются изображения. Разделение fixtures/production сохранено и проверено.

## Изменённые файлы

- `apps/web/components/market.module.css` — scoped публичная design system и responsive layout.
- `apps/web/components/shell.tsx`, `hero.tsx`, `market-navigation.tsx`, `market-icons.tsx` — header, top bar, hero, navigation, CTA и иконки.
- `apps/web/components/cards.tsx`, `search.tsx`, `two-gis-link.tsx` — карточки, оформление существующего поиска и подпись безопасной ссылки.
- `apps/web/lib/market-navigation.ts` — отображение разделов через существующие category slugs либо безопасный search query.
- `apps/web/app/layout.tsx`, `page.tsx`, `catalog/page.tsx`, `product/[slug]/page.tsx`, `shop/[slug]/page.tsx` — подключение публичного оформления.
- `apps/web/next.config.ts` — ограниченный image allowlist `/brand/**`; защищённый `/api/images/**` не добавлен в optimizer.
- `apps/web/lib/catalogue/fixtures.ts`, `test/catalogue.test.ts` — 4 публичных demo-магазина и 8 demo-товаров, обновлён ожидаемый размер fixture-набора; проверки скрытых записей сохранены.
- `apps/web/test/market-navigation.test.ts`, `apps/web/package.json`, `scripts/web-preview.test.mjs` — 4 новые автоматические проверки UI/navigation/assets.
- `apps/web/public/brand/`, `apps/web/public/dev-fixtures/` — 9 новых растровых assets; существующие фотографии не перезаписаны.
- Этот отчёт и `docs/phase-7c-assets.md`.

Backend, authentication, permissions, database schema, migrations, subscriptions, Halyk и BFF handlers не изменялись.

## Database

Database: изменений нет. Новых таблиц, индексов и миграций нет. Интеграционные тесты использовали отдельную локальную `qrg_market_test` и собственные временные записи; production database не использовалась.

## Security

- IDOR/BOLA и межмагазинная изоляция, подмена role/shop/member/product/variant, CSRF, opaque sessions и MFA — PASS существующих regression suites.
- Гостевые заявки, нормализация телефона, consent, anti-spam, replay и payload limits — PASS.
- Безопасные 2GIS и WhatsApp ссылки и кодирование параметров — PASS unit и built-frontend smoke tests.
- Upload MIME/decode/size limits, private images и orphan cleanup с локальным S3 — PASS.
- Поддельный success redirect, amount/currency/merchant/subscription mismatch, replay и reused payment ID — PASS offline payment contracts и PostgreSQL tests. Реальный банк не вызывался, списаний не было.
- Новый navigation query encoding не позволяет внедрить дополнительные параметры или fragment. Image optimizer отклоняет защищённый API image proxy.
- Production smoke подтверждает отсутствие fixture-записей даже при `QRG_DEV_FIXTURES=true`. Демонстрационные рейтинги и ложные opening hours не созданы.

## Tests

Все перечисленные команды выполнены успешно 14 сентября; skipped/todo нет. Всего 188 различных tests (smoke suites повторяют часть integration tests).

| Команда                                            | Результат             |
| -------------------------------------------------- | --------------------- |
| `pnpm test:critical`                               | PASS, API 56 + web 21 |
| `pnpm --filter @qrg/web test` после новых проверок | PASS, 21              |
| `pnpm test:web:preview`                            | PASS, 10              |
| `pnpm test:db`                                     | PASS, 43              |
| `pnpm test:payments`                               | PASS, 8               |
| `pnpm test:subscriptions`                          | PASS, 12              |
| `pnpm test:admin`                                  | PASS, 13              |
| `pnpm test:requests`                               | PASS, 10              |
| `pnpm test:media`                                  | PASS, 8               |
| `pnpm test:catalog:smoke`                          | PASS, 14              |
| `pnpm test:seller:smoke`                           | PASS, 9               |
| `pnpm test:requests:smoke`                         | PASS, 11              |
| `pnpm test:admin:smoke`                            | PASS, 14              |
| `pnpm test:subscriptions:smoke`                    | PASS, 13              |
| `pnpm test:smoke`                                  | PASS, 2               |

При первой браузерной проверке обнаружена ошибка Next Image: сочетание `fill` и изменённого `style.width` в category sprite. Исправлена через явные intrinsic dimensions и позиционирование; SSR, browser rendering и оптимизация всех новых assets после исправления прошли. Также исправлен переход из footer к «Как работает QRG»: секция вынесена из details и доступна через стандартный Next Link. Промежуточный native anchor вызывал lint error и hydration warning при автоматическом раскрытии details; этот вариант удалён. Тесты не удалялись и защитные проверки не отключались.

## Typecheck

`pnpm typecheck` — PASS, web и API, strict mode сохранён.

## Lint

`pnpm lint` — PASS: ESLint обоих приложений и Prettier. Новые документы также отформатированы.

## Production Build

`pnpm build` — PASS: Next.js production build и NestJS TypeScript build. Production boot smoke и SSR/BFF suites запускались на собранном frontend с реальным локальным API/PostgreSQL.

## Design comparison

MATCHED означает совпадение визуального принципа и композиции, а не pixel-perfect копию фотографии. Сравнение выполнено по реальному browser screenshot, не только по коду.

| Элемент             | Статус            | Результат сравнения                                                                                                        |
| ------------------- | ----------------- | -------------------------------------------------------------------------------------------------------------------------- |
| TOP BAR             | MATCHED           | Узкая тёмная полоса, город, slogan, links и золотистый CTA                                                                 |
| HEADER              | MATCHED           | Белый компактный header, logo слева, широкий поиск, actions справа                                                         |
| CATEGORY NAVIGATION | MATCHED           | Отдельная тонкая строка, нужный порядок, horizontal scroll на mobile                                                       |
| HERO                | PARTIALLY MATCHED | Совпадает композиция, текст и поиск слева; используется новая иллюстративная фотография, не исходное фото                  |
| CATEGORY STRIP      | PARTIALLY MATCHED | 11 компактных tiles; новые предметные изображения, не идентичные референсу                                                 |
| SHOP CARDS          | PARTIALLY MATCHED | 4 cover-карточки, круглая монограмма и 2 кнопки; нет выдуманных logos, ratings или hours                                   |
| PRODUCT CARDS       | PARTIALLY MATCHED | 8 компактных карточек; квадратное фото по текстовому ТЗ, поэтому выше некоторых изображений референса                      |
| BOTTOM CTA          | MATCHED           | Тёмный горизонтальный блок, преимущества, 10 000 ₸/месяц, gold button                                                      |
| COLORS              | MATCHED           | White/graphite/charcoal и muted sand, без неона                                                                            |
| TYPOGRAPHY          | MATCHED           | Sans serif, жирный hero/section headings, компактная информация                                                            |
| SPACING             | PARTIALLY MATCHED | Плотные ряды и компактные секции; страница выше из-за честных demo labels, квадратных фото, дополнительных секций и footer |

Неисправленных NEEDS FIX нет. Не заявляется точное попиксельное совпадение или полная accessibility-сертификация; реальные iOS/Android устройства в этой фазе не проверялись.

## Известные проблемы

- Избранное ещё не реализовано; соответствующие иконки явно disabled. Рейтинги, реальные logo и opening hours отсутствуют в текущем shop contract, поэтому не выдумываются. Live-подборки не называются рейтингом популярности без аналитических данных.
- Halyk PHASE 7B по фактическому состоянию репозитория остаётся частичной: checkout/recurring/callback activation отключены до корректного signature contract, merchant settings и credentials. Это прежний blocker, а не UI-регрессия; см. `phase-7b-report.md` и payment audit.
- Development Next.js выдаёт рекомендацию eager loading для отдельных LCP-изображений при смене фильтров; это не ошибка загрузки. Performance audit на production data не выполнялся.

## Технический долг

После перехода на scoped public CSS часть старых публичных selectors в `globals.css` больше не используется. Они оставлены вместе с общими styles, чтобы не расширять фазу до рискованной очистки seller/admin оформления; требуется отдельная bounded CSS cleanup. Новых инфраструктурных зависимостей или обходов security нет.

## Следующая рекомендуемая фаза

Закрытие оставшихся blockers PHASE 7B после предоставления банковского контракта и настроек; PHASE 8 — только по отдельной команде владельца. Автоматический переход не выполнялся.
