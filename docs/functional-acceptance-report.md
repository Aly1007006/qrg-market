# QRG MARKET — FUNCTIONAL ACCEPTANCE & SELLER WORKFLOW COMPLETION

Дата: 3 октября 2026 года.

## Итог

Локальный сайт запущен на `http://localhost:3000` с настоящими Next.js, NestJS, PostgreSQL и S3-совместимым хранилищем. Это не статический макет и не frontend, подключённый к fake API. Development fixtures в этой витрине выключены.

Через браузер зарегистрированы тестовые продавцы, создан и заполнен бутик, загружены логотип и обложка, размещены два тестовых товара с фотографиями. Проверены редактирование, наличие, дублирование, архив, вкладки кабинета, сессии и запрет доступа другому продавцу. Магазин отправлен на обязательную проверку.

**Локальная приёмка проверенных сценариев: PASS. Коммерческий production launch: не подтверждён.** Банковский checkout, отправка reset email и облачная инфраструктура требуют отдельных внешних настроек и acceptance evidence. Нельзя считать их завершёнными на основании локальных тестов.

## Сделано

### 1. Исправлен реальный запуск приложения

В local Compose frontend использовал известный development proxy key. Next.js в production build правильно запрещал такой ключ; API также не получал согласованную конфигурацию. Это препятствовало seller BFF, несмотря на отдельно работающие страницы и health endpoints.

- API и Web теперь получают один обязательный `QRG_INTERNAL_PROXY_SECRET`, переданный API как `INTERNAL_PROXY_SECRET`.
- Добавлен `pnpm dev:docker` и отдельный launcher `scripts/local-start.mjs`.
- Launcher использует явно заданную конфигурацию либо повторно использует пароль существующего Compose database container. Данные и volumes не удаляются.
- Для локального запуска генерируется случайный ephemeral proxy key. Ключ передаётся процессу Docker, не записывается в исходники и не печатается в логах.
- Уже настроенный локальный MFA encryption key сохраняется; новый административный доступ не создаётся.
- При поиске database container проверяются Compose project, service и container-number. Это исключает случайный выбор тестового контейнера, унаследовавшего labels PostgreSQL image.
- Повторный запуск и пересоздание API/Web проверены: бутик, товары, изображения и аккаунты сохраняются.
- Строгие engines не отключались. Приложение и проверки работают в Docker с Node.js 24.21.0 и pnpm 11.26.0. Host Node.js используется только для Docker launcher.

### 2. Доработана регистрация и поведение аккаунта

- Добавлена понятная подсказка: пароль от 12 до 128 символов.
- При регистрации добавлено подтверждение пароля. Несовпадение блокирует отправку и переводит фокус к повторному вводу.
- Подтверждение не передаётся API и не меняет его contract.
- Добавлено доступное переключение видимости пароля.
- Неверный пароль больше не отображается как «сессия истекла»: сообщение нейтрально относительно существования аккаунта.
- Rate limit и ошибки недоступного сервиса не скрываются этим сообщением.
- На странице списка магазинов отображается собственный invitation user ID и доступна кнопка выхода. Теперь пользователь может выйти или сообщить свой ID владельцу, даже если ещё не создал магазин.
- Успешное сохранение товара в неактивном магазине сообщает: «Товар сохранён — магазин пока скрыт». Публикация storefront не обещается до выполнения требований.

### 3. Исправлена обнаруженная SQL-проблема

Повторный integration run обнаружил нарушение batch limit в очистке персональных данных. `EXPLAIN` показал `Nested Loop Semi Join` с подзапросом `IN (SELECT ... LIMIT ... FOR UPDATE SKIP LOCKED)`. При повторном сканировании после изменения строк такой план мог обработать более одной записи при лимите 1.

- Выборка каждой партии теперь выполняется один раз в `MATERIALIZED` CTE.
- UPDATE/DELETE выполняются по материализованному набору идентификаторов.
- Тот же опасный паттерн исправлен для очистки analytics events, rate buckets, reset tokens, seller sessions и admin sessions.
- Сохранены прежние retention thresholds, размеры партий, locks, `SKIP LOCKED`, idempotency и legal hold.
- Audit trail, пользователи и магазины этим кодом не удаляются.
- Regression test принудительно отключает hash join, merge join и implicit materialization внутри **тестовой транзакции**, чтобы проверить проблемный тип плана. Настройки production PostgreSQL не меняются.
- Добавлен тест с 1 003 просроченными rate buckets: один вызов не может удалить более 1 000.
- Два последовательных targeted run дали PASS 12/12; после этого прошли полный integration run и built request smoke.

Очистка пользовательской local database в рамках приёмки не запускалась. Все эксперименты с retention выполнялись только на отдельной disposable test database.

### 4. Проверен настоящий workflow продавца

Созданные данные явно помечены как тестовые, не являются реальными предложениями к продаже и не публиковались в обход правил проекта.

| Объект                    | Результат                                                                               |
| ------------------------- | --------------------------------------------------------------------------------------- |
| Основной тестовый аккаунт | `qrg-check-20261003@example.test`, обычный продавец                                     |
| Второй тестовый аккаунт   | `qrg-check-other-20261003@example.test`, без доступа к первому бутику; сессия завершена |
| Бутик                     | `ТЕСТ QRG · Проверка продавца`                                                          |
| Shop ID                   | `3a57f5b7-f525-48a4-87fc-6b251456b25d`                                                  |
| Статус бутика             | `PENDING_VERIFICATION`                                                                  |
| Оформление                | Адрес, торговый центр, синтетический телефон/WhatsApp, загруженные logo и cover         |
| Подписка                  | Создана без оплаты: `SUSPENDED`, trial и auto-renew выключены                           |
| Первый товар              | `ТЕСТ · Сумка для проверки QRG`, 19 500 ₸, описание, категория, вариант и JPEG-фото     |
| Product ID первого товара | `04992864-b169-4315-9560-bfc4e126d390`                                                  |
| Второй товар              | `ТЕСТ · Платье для проверки QRG`, 22 000 ₸, описание, категория, наличие и PNG-фото     |
| Product ID второго товара | `e85a1b50-4fd0-4f21-acd5-e6803918fa73`                                                  |
| Тест дублирования         | Создана копия с новым ID/slug, без копирования изображений; затем помещена в архив      |
| Публичность               | Бутик и товары недоступны через public routes до модерации и действующего entitlement   |

Контакты синтетические. Настоящая карточка 2GIS не выдумывалась: поле оставлено пустым. Посторонний домен `example.test` был введён для отрицательной проверки и отклонён backend; перед модерацией поле очищено.

Учётные пароли, cookies, session tokens, MFA keys и database credentials в этот отчёт не включены. Пользовательские магазины и аккаунты не изменялись; административные роли существующим пользователям в этой приёмке не назначались.

## Изменённые файлы

Основные файлы текущего прохода:

| Файл                                            | Изменение                                                       |
| ----------------------------------------------- | --------------------------------------------------------------- |
| `compose.yaml`                                  | Согласованный обязательный proxy key для API/Web                |
| `.env.example`                                  | Название переменной и безопасное пояснение без настоящего ключа |
| `scripts/local-start.mjs`                       | Безопасный local Docker launcher                                |
| `scripts/local-start.test.mjs`                  | Проверки конфигурации, сохранения credentials и labels          |
| `package.json`                                  | `dev:docker` и включение launcher regression tests              |
| `README.md`                                     | Воспроизводимый запуск, вариант без неподходящего host pnpm     |
| `apps/web/components/seller/forms.tsx`          | Password confirmation, visibility и корректная login error      |
| `apps/web/lib/seller/errors.ts`                 | Типизированная безопасная классификация API errors              |
| `apps/web/components/seller/product-editor.tsx` | Честное сообщение о сохранении в скрытом бутике                 |
| `apps/web/app/seller/[[...segments]]/page.tsx`  | Invitation ID и logout до создания магазина                     |
| `apps/web/test/seller.test.ts`                  | Regression checks account UX и сообщения о публикации           |
| `apps/api/src/db/cleanup.ts`                    | Материализованные партии bounded cleanup                        |
| `apps/api/test/requests.integration.test.ts`    | Защита от rescanning query plan и batch deletion regression     |
| `docs/functional-acceptance-report.md`          | Этот отчёт                                                      |

В worktree уже находились изменения предыдущих recovery, infrastructure, security и UI проходов. Они сохранены; общий Git diff включает не только перечисленные выше изменения. Commit и push не выполнялись.

## Database

Новых migrations, таблиц, колонок или индексов в этом проходе не создано. Local launcher запускает существующий штатный migration command; он завершился успешно. Существующие миграции также проверены на отдельной PostgreSQL с PostGIS и pg_trgm.

В локальную development database добавлены запрошенные тестовые записи пользователей, магазина, membership, адреса/контактов, товаров/вариантов, media metadata, неоплаченной подписки и отправки на модерацию. Binary image data не записывались в PostgreSQL: файлы находятся в Object Storage.

SQL cleanup исправлен без изменения schema и без изменения бизнес-политики retention. Пользовательские database/media volumes сохранены.

После успешного финального прогона удалены только созданные для этой приёмки
одноразовые контейнеры `qrg-functional-db` и `qrg-functional-storage` вместе с их
anonymous volumes. Это синтетические fixtures; их можно создать повторным
запуском тестов. Основные `qrg-market-local` database/media volumes и созданные
через пользовательский интерфейс тестовые бутик/товары не удалялись.

## Security

- Проверены signup/login, неправильный пароль, rotation, logout и revoke-all.
- Проверены HttpOnly cookies, session hash storage, CSRF, rate limiting и membership revocation существующими automated tests.
- Второй продавец в ручной проверке не видит чужой бутик в своём списке. Подмена URL чужого товара возвращает недоступную страницу, без данных или редактора.
- Seller session не открывает Admin Area; требуется отдельный административный вход. Privileged admin scenarios проверены изолированными integration/built tests, без использования реального аккаунта владельца.
- Сохранены обязательная модерация, заморозка проверяемых сведений, MFA, controlled admin lifetime и immutable audit trail.
- Backend отклоняет посторонний URL в поле 2GIS. Проверены allowlist, canonicalization и DB constraints.
- JPEG/PNG прошли реальный upload/decode/resize/storage round trip в браузере. Automated tests дополнительно проверяют WEBP, EXIF removal, malicious MIME/data, oversized files, 10-image limits, concurrent reservations, idempotent retry, IDOR и orphan cleanup.
- Public routes не раскрывают непроверенный бутик и его товар даже по известному slug.
- Заявки проверены как гостевые обращения, не оплаченные заказы; validation, consent, anti-spam, replay и tenant isolation сохранены.
- Analytics проверена без копирования телефонов, email, raw IP или request body.
- Payment scenarios проверены только offline: amount/currency/merchant/subscription association, duplicate IDs, callback replay и fake redirect. Реальная банковская транзакция не выполнялась.
- Batch cleanup теперь ограничена независимо от выбранного planner strategy. Legal hold не обходится, audit fields сохраняются.
- Secrets не записывались в report, source или `.env.example`. Не выполнялись ослабление engines, security gates, fake payment activation либо выдача административной роли тестовым seller accounts.

## Tests

Проверки выполнялись в Docker: Node.js 24.21.0, pnpm 11.26.0, отдельные PostgreSQL и SeaweedFS. Пользовательская local database использовалась только для явно запрошенного ручного сценария создания тестового бутика, а не для destructive integration fixtures.

### Автоматические проверки — финальный прогон

| Проверка                                                         | Результат           |
| ---------------------------------------------------------------- | ------------------- |
| `pnpm test`: Web                                                 | PASS 36/36          |
| `pnpm test`: API unit                                            | PASS 64/64          |
| `pnpm test`: local launcher                                      | PASS 3/3            |
| Все `*.integration.test.js`, последовательно, real PostgreSQL/S3 | PASS 130/130        |
| `pnpm test:catalog:smoke`                                        | PASS 15/15          |
| `pnpm test:seller:smoke`                                         | PASS 11/11          |
| `pnpm test:requests:smoke`                                       | PASS 13/13          |
| `pnpm test:admin:smoke`                                          | PASS 15/15          |
| `pnpm test:subscriptions:smoke`                                  | PASS 13/13          |
| `pnpm test:smoke`                                                | PASS 2/2            |
| `pnpm test:web:preview`                                          | PASS 13/13          |
| Targeted request regression, два последовательных запуска        | PASS 12/12 в каждом |
| `node scripts/source-integrity.mjs`                              | PASS                |
| `git diff --check`                                               | PASS                |

Built smoke tests запускают собранный Next.js против настоящего NestJS API и test PostgreSQL. Проверка guest lead включает server challenge, отправку без регистрации, сохранение и доступ продавца; проверка admin включает real queue/history/audit SSR. Offline payment fixtures не являются подтверждением live Halyk.

### Ручная браузерная проверка

| Вкладка / сценарий          | Результат и границы проверки                                                                                                                                  |
| --------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Регистрация                 | Два аккаунта созданы через UI, затем выполнен вход; несовпадающие пароли отклонены с фокусом на поле                                                          |
| Неверный пароль             | Доступ отклонён; после исправления UI показано корректное нейтральное сообщение                                                                               |
| Список магазинов            | Новый бутик создан, после повторного входа доступен владельцу; logout доступен пользователю без бутика                                                        |
| Обзор                       | Onboarding и готовность основаны на сохранённых данных; показана причина отсутствия public storefront                                                         |
| Товары                      | Полный и быстрый masters, описание, категория, цена, вариант, фото, редактирование, наличие, copy, archive и status filter                                    |
| Заявки                      | Открывается штатный empty state и фильтр; создание/обработка заявки активного магазина проверены built integration, не обходом статуса тестового бутика       |
| Статистика                  | Шесть ожидаемых смысловых блоков включая популярные товары; периоды 7/30/90 работают, вымышленные просмотры не добавлялись                                    |
| Подписка                    | Неоплаченная запись создана; статус SUSPENDED, auto-renew off, online renewal недоступен без provider                                                         |
| Магазин                     | Адрес/контакты/branding сохраняются после перезапуска; moderation submission меняет статус на PENDING_VERIFICATION и блокирует изменение проверяемой identity |
| Сотрудники                  | Владелец и формы ролей отображаются; приглашение реального человека не выполнялось. Permission mutations проверены isolated integration tests                 |
| Настройки                   | Rotation, revoke-all, выход и повторный вход проверены; данные магазина не потеряны                                                                           |
| Обучение                    | Открываются инструкции и ссылки на соответствующие seller routes                                                                                              |
| Homepage                    | Настоящая API-витрина, поиск и корректные empty states без fake магазинов/рейтингов                                                                           |
| Catalog / Filters           | Поиск, mobile drawer, категория/price/availability и URL synchronization; закрытие Escape возвращает фокус на кнопку фильтров                                 |
| Shops / Favorites / Privacy | Страницы открываются без ошибки; отсутствие реальных ACTIVE предложений не заполняется fixtures                                                               |
| Public product / shop       | Прямые ссылки тестового непроверенного магазина корректно закрыты: 404, без карточки/контактов                                                                |
| Admin                       | Обычная seller session перенаправляется к отдельному admin login. Полный privileged browser login реального администратора не выполнялся                      |

### Промежуточные ошибки и их устранение

1. Первый повторный launcher run обнаружил дополнительный тестовый PostgreSQL container по унаследованным image labels. Добавлена обязательная проверка container-number, повторный запуск успешен.
2. Новая TypeScript parameter property не поддерживалась native Node.js type stripping в Web tests. Заменена обычным объявлением поля и присваиванием, без отключения TypeScript или изменения test runner.
3. Один production smoke запуск ошибочно получил development HTTP S3 environment из общего integration command. Production config правильно отказалась стартовать. Окружения разделены: production smoke проходит отдельно, integration использует local HTTP storage только в test environment.
4. Повторный integration run обнаружил настоящее превышение SQL batch limit. Исправлен production SQL, усилены assertions; полный финальный прогон зелёный. Тест не удалялся и лимиты не увеличивались.

## Typecheck

`pnpm typecheck`: PASS для Web и API. Next route types сгенерированы; strict mode сохранён.

## Lint

`pnpm lint`: PASS. ESLint — без предупреждений; Prettier checks — PASS. После добавления отчёта отдельно проверена его formatting вместе с README.

## Production Build

`pnpm build` в Docker build target: PASS для NestJS и Next.js. Собраны runtime images; local API/Web containers healthy, migration container завершился с кодом 0.

Production Next.js smoke не допускает development fixtures; production API smoke закрывает Swagger. Публичный commercial deployment не выполнялся. Docker warning об отсутствии Git commit metadata в build context не является ошибкой сборки; `.git` не включается в Docker context.

## Performance / Accessibility / UX

- Все девять вкладок кабинета проверены в браузере при ширине 390 px: document scroll width 375 px, то есть горизонтального переполнения страницы нет. Отдельно проверена сохранённая карточка товара с фото.
- При той же ширине проверены Homepage, Catalog, Shops, Favorites и Privacy. Header и мобильная навигация остаются компактными.
- Desktop seller product list проверен визуально; обе фотографии реально загружены (`complete` и `naturalWidth > 0`), а не являются placeholder.
- Формы имеют labels; password help привязан к input, confirmation mismatch переводит фокус, visibility toggle сообщает состояние.
- Native filter dialog закрывается Escape с возвратом фокуса; URL filters и выбранные параметры сохраняются.
- SEO/security regressions проверяют metadata/robots/sitemap/noindex, CSP, structured-data escaping и отсутствие fake rating data.
- Catalogue/analytics integration tests проверяют существующие индексы и SQL query plans. Найденный cleanup query plan исправлен материализацией партии.
- Не добавлены Redis, OpenSearch, Elasticsearch, новые runtime dependencies либо постоянный tracking identifier.
- Это не сертификат WCAG и не production load test. Реальные latency, Core Web Vitals и нагрузка должны измеряться на целевой инфраструктуре с репрезентативными данными.

Доказательства браузерного результата сохранены вне репозитория:

- `C:/Users/X-Game/.codex/visualizations/2026/09/08/01a0818d-463b-7aa1-b305-1f276c7e4a93/functional-acceptance/seller-products-desktop.jpg`
- `C:/Users/X-Game/.codex/visualizations/2026/09/08/01a0818d-463b-7aa1-b305-1f276c7e4a93/functional-acceptance/product-mobile.jpg`

## Известные проблемы

1. Live Halyk checkout/recurring/callback activation остаётся заблокированным. Нужны merchant credentials/settings, подтверждённый банком callback verification contract, реализация оставшейся write integration и acceptance E2E. Одного заполнения credentials недостаточно. Fake success не используется.
2. Production email delivery для password reset не настроена; frontend не обещает доставку письма. Нужны выбранный provider, настроенная отправка и проверка реального reset delivery/consumption.
3. Публичный HTTPS domain, Kazakhstan production hosting и независимый backup/restore evidence в этой локальной приёмке не развёрнуты и не подтверждены. Требования MASTER CONTEXT не отменены.
4. Политики privacy/retention и остальные launch approvals необходимо подтвердить перед коммерческим запуском; local tests не заменяют эти решения.
5. Тестовый бутик намеренно непубличный: он ожидает moderation и не имеет оплаченной подписки. Это ожидаемое состояние, а не оставленная неисправность каталога.

## Технический долг

Новых bypass, mock production functions, зависимостей или изменений API contracts не создано. UI assertions дополняют, но не заменяют integration и ручной browser acceptance. Не заявляется автоматический browser E2E для каждого действия, которое здесь выполнено вручную.

Оставленные в development database тестовые accounts/shop/products явно помечены и должны быть исключены из переноса в production. Их сохранение сделано намеренно, чтобы пользователь мог проверить результат. Удаление этих данных или audit trail автоматически не выполнялось.

## Следующая рекомендуемая фаза

**Закрытие внешних production blockers и staging acceptance:** real reset delivery, bank-confirmed Halyk integration, Kazakhstan HTTPS deployment и verified independent restore test. Затем повторить production gate.

Эта следующая работа автоматически не запускается. Локальный сайт остаётся доступным; коммерческая готовность не объявляется без внешних доказательств.
