# PHASE 8B — итоговый отчёт

Дата: 23 сентября 2026.

**PHASE 8B STATUS: READY** — реализация и локальные quality gates выполнены. Это не разрешение production-запуска: отдельный банковский gate PHASE 7B остаётся закрыт. PHASE 9 не начата.

## Сделано

Расширены существующие seller/admin модули без параллельного authentication, analytics, media или billing. Добавлены удобное создание товаров, черновики, onboarding, обучение и Admin Control Center. Публичный стиль PHASE 7C сохранён. Из публичной навигации убраны «Детские товары», «Для дома», «Спорт», «Ещё» согласно уточнению PHASE 8B; taxonomy и пользовательские записи не удалялись.

## Изменённые файлы

Основные файлы всей фазы, включая ранее реализованную часть:

- `apps/api/src/catalogue/operations.{controller,dto,service}.ts`, `seller.service.ts` — seller operations.
- `apps/api/src/admin/` — bootstrap, enrollment, permissions, control, moderation и audit.
- `apps/api/src/media/{service,controller}.ts`, `apps/api/src/db/schema.ts`, `apps/api/drizzle/0009–0012*.sql`.
- `apps/web/components/seller/` — product-editor, draft-storage, product-list, image-manager, onboarding, academy, forms.
- `apps/web/components/admin/`, seller/admin routes и BFF allowlists.
- `apps/web/app/shop/[slug]/page.tsx`, `apps/web/components/market-navigation.tsx`, `market.module.css`, `apps/web/lib/market-navigation.ts`.
- API integration/unit tests, web tests, `scripts/web-preview.test.mjs`, `scripts/phase8b-ux-preview.mjs`, `.github/workflows/ci.yml`, `.env.example`, package manifests и lockfile.

Локальный `apps/api/.env` исключён из Git. Секреты в отчёт не включены.

## Database / Migrations

Применены миграции 0009–0012; всего 13 миграций в локальной и тестовой БД:

- `product_drafts`: shop/user/product FK, версия > 0, ограниченный JSONB, индекс `(shop_id,user_id,updated_at)`; связанный product удаляется только с учётом RESTRICT.
- `admin_accounts`: platform roles, обязательная смена пароля, pending/enrolled encrypted TOTP, recovery hashes; `admin_sessions.mfa_verified_at`.
- `products`: moderation visibility и CHECK, запрещающий публикацию скрытого модерацией товара; `audit_logs.reason/request_id`.
- `seller_onboarding`: уникальная пара shop/user; `shop_images`: logo/cover, уникальные shop/kind и object key, FK и CHECK dimensions/key; media intents расширены для магазинов.
- В moderation history разрешён RESTORE; другие ограничения сохранены.

Перед изменениями сделана локальная резервная копия. После завершения в рабочей dev БД сохранены 3 магазина и 3 товара. Автоматического destructive rollback нет: откат требует проверенного backup/forward migration, чтобы не потерять новые данные. Тестовые UX-записи и их S3-объекты удалены только по UUID конкретного тестового запуска; пользовательские данные не затрагивались.

## Product UX

Категории и бренды выбираются по названию из API; технические ID и ручной slug не требуются. Фото, цены, варианты, наличие и предпросмотр доступны в одном процессе. Дублирование создаёт новый DRAFT с новыми ID/slug без аналитики и заявок. SKU и изображения не переносятся: текущие image keys привязаны к исходному product. Массовые операции ограничены, атомарны и tenant-scoped; физического bulk DELETE нет.

## Quick Add

Фото, название, категория, цена, наличие → публикация. Сначала сохраняется единственный DRAFT, затем проходят безопасная загрузка и публикация. В успехе доступны дальнейшее редактирование, следующий товар и просмотр; публичность всё равно зависит от статуса/подписки магазина.

## Full Product Wizard

Шесть шагов: фото, информация, цена, варианты, наличие, предпросмотр. Изображения можно выбрать/перетащить, удалить, сделать основными, переставить кнопками — drag не обязателен. Есть выбор камеры для поддерживающих браузеров и прогресс загрузки. Использована существующая модель availability без новой WMS.

## Autosave

Debounce, серверные версионированные черновики, IndexedDB для локальных файлов и восстановления. Неполные поля не создают лишние товары; материализация защищена от конкурентного повтора. Предупреждение о несохранённых изменениях учитывает завершение локального сохранения. При потере ответа повтор загрузки использует стабильный UUID: тот же обработанный файл возвращает прежнее изображение, несовпадающее содержимое отклоняется.

## Mobile Product Management

Через computer-use проверены seller login, Quick Add, refresh/resume сохранённого черновика, wizard/preview и список товаров на 375, 390, 430 px. Проверены admin login с TOTP, обзор на 375, пользователи на 390, магазины на 430 px. Ширины документа соответственно 360/375/415 px при scrollbar 15 px: горизонтального переполнения страницы нет. Формы имеют labels, кнопки перестановки фото, видимый focus и сообщения состояния. Камера физического телефона и весь сценарий потери сети на устройстве не проверялись; это не полная WCAG-сертификация.

## Seller Onboarding

Сохраняемый skip/resume, реальный checklist: данные магазина, logo, cover, WhatsApp, 2GIS, первый товар, проверка страницы. Branding проходит тот же secure image pipeline; замена помечает старый объект для cleanup. Прогресс не выдумывается. Обложка/логотип отображаются через защищённый image endpoint без несовместимого повторного Next image optimization.

## QRG Academy

13 коротких встроенных материалов с контекстными ссылками. Обучение объясняет товары, фотографии, варианты, заявки, публичность и подписку; не подменяет обязательные security/payment проверки.

## Admin Control Center

Отдельные маршруты и сессии. Реальные агрегаты overview; списки магазинов, пользователей, товаров, подписок и администраторов; moderation и audit. Списки ограничены пагинацией, нет загрузки всей БД в браузер. Коррелированные запросы списка магазинов исправлены: ссылки явно привязаны к `shops.id`, без неоднозначных колонок.

## Initial SUPER_ADMIN

По явному согласию владельца существующий аккаунт `alymjan100706csgo@gmail.com` назначен SUPER_ADMIN в локальной dev БД. Его текущий пароль сохранён; временный пароль из задания существующему пользователю не устанавливался. Включена обязательная смена пароля, затем 2FA. Для первого входа использовать текущий пароль и оставить поле второго фактора пустым, пока он не настроен. Изменение пароля и настройку MFA пользователь выполняет лично. Повторный bootstrap не сбрасывает пароль и не создаёт второго initial SUPER_ADMIN.

## Admin Authentication

Opaque sessions с hash в БД, отдельные HttpOnly/SameSite Strict cookies, Secure в production, CSRF, rotation/revoke, абсолютный срок 60 минут и idle 15 минут. Bootstrap-сеанс имеет доступ только к настройке безопасности до смены пароля и подтверждения MFA. Login rate limit и запрет seller-cookie substitution сохранены.

## 2FA

TOTP с локально генерируемым QR; secret зашифрован и привязан к аккаунту, recovery codes хранятся как hashes и одноразовы. Повтор TOTP/recovery блокируется. Без настроенного encryption key или подтверждённого MFA privileged access закрыт. Локальный encryption key сохранён в ignored env; production требует secret manager и контролируемого backup ключа.

## Roles & Permissions

SHOP_OWNER/MANAGER/EMPLOYEE вычисляются через membership. SUPER_ADMIN, MODERATION_ADMIN, SUPPORT_ADMIN, FINANCE_ADMIN имеют серверные permissions. Legacy ADMIN сохранён для совместимости. DTO используют конечные enum/actions, неизвестные поля запрещены. Смена client-side role не даёт полномочий; последний активный SUPER_ADMIN защищён транзакционной проверкой.

## Shop Management

Поиск/статусы, владелец, количество товаров, состояние подписки, история и причины решений. APPROVE не подделывает подписку; RESTORE возвращает магазин через существующие правила публичности. Только ACTIVE с действующим entitlement публикуется.

## User Management

Поиск, memberships, блокировка/разблокировка, revoke sessions. Передача владения атомарна и проверяет совместимость user/member/shop. Создание, роли и деактивация admins доступны только разрешённой platform role; действия аудируются.

## Product Moderation

HIDE/RESTORE с причиной, без физического DELETE. Seller edit, bulk publish и duplicate не обходят moderationHidden. Восстановление сохраняет прежний допустимый статус, а не безусловно публикует всё.

## Subscriptions

Read-only административные сведения: магазин, тариф, статус, период, next billing и платежи. Нет кнопки «сделать платёж успешным». 10 000 KZT задаётся backend. Halyk provider hard gate не снят; реальные списания не выполнялись.

## Audit Log

Используется существующий immutable audit_logs: actor/action/target/reason/timestamp/result/request ID. Критические действия создают записи; обычные admin endpoints не редактируют и не удаляют журнал. Пароли, tokens, TOTP secrets и payment secrets в ответы/аудит не добавлены.

## Privacy

Нет новых analytics identifiers/raw IP/customer phones. Admin views не добавляют доступ ко всем CustomerRequest телефонам. Backend отдаёт явные DTO, а не credential columns. Изображения теряют EXIF; временные preview-файлы остаются в браузере до upload.

## Security Findings

Исправлены обнаруженные проблемы повторной отправки upload после потери ответа, некорректной tenant UUID до SQL, привязки member/user при передаче магазина и неоднозначного SQL admin списка. Автоматические проверки покрывают IDOR/BOLA, role tampering/mass assignment, CSRF, session/recovery replay, brute force, moderation bypass, malicious uploads, XSS escaping, платежные подмены. Известных неустранённых HIGH/CRITICAL по этим проверкам нет; это не независимый внешний pentest.

## Security Fixes

Добавлены безопасное идемпотентное повторение фото, строгая проверка branding UUID, явное согласие на promotion существующего initial admin, конкурентный bootstrap и защита последнего SUPER_ADMIN. Сохранены реальное image decoding, MIME/size checks, tenant/CSRF и immutable audit. Проверки не отключались, тесты не удалялись ради зелёного результата.

## Tests

Итоговые прогоны 23.09.2026 — PASS:

| Команда                                    | Результат                 |
| ------------------------------------------ | ------------------------- |
| `pnpm test`                                | 61 API + 26 web           |
| `pnpm test:db`                             | 43                        |
| `pnpm test:operations`                     | 7                         |
| `pnpm test:admin-control` с built-web gate | 15                        |
| `pnpm test:payments`                       | 8, offline bank transport |
| `pnpm test:seller:smoke`                   | 11                        |
| `pnpm test:requests:smoke`                 | 11                        |
| `pnpm test:admin:smoke`                    | 14                        |
| `pnpm test:subscriptions:smoke`            | 13                        |
| `pnpm test:analytics`                      | 8                         |
| `pnpm test:catalog:smoke`                  | 14                        |
| `pnpm test:smoke`                          | 2                         |
| `pnpm test:web:preview`                    | 10                        |

Часть smoke-команд повторяет integration cases, поэтому сумма не заявляется как количество уникальных тестов. `pnpm audit --prod --audit-level=high`: известных уязвимостей не найдено.

Промежуточные ошибки не скрыты: production smoke однажды получил запрещённые локальные S3 env из общего test shell; повтор в чистом окружении прошёл без ослабления production validation. Тест bootstrap конфликтовал с временным UX SUPER_ADMIN в test DB; после адресной очистки UX fixture прошёл. Остальные найденные SQL/typing/lint ошибки исправлены до итоговых прогонов.

## Typecheck

PASS: `pnpm typecheck`, TypeScript strict сохранён.

## Lint

PASS: `pnpm lint`, ESLint и Prettier.

## Production Build

PASS: `pnpm build` для Next.js и NestJS; production health/Swagger/noindex smoke прошли. Это сборка и локальный preview, не production deployment.

## Regression Check

Подтверждены тестами homepage/catalog/search, product/shop links, safe 2GIS/WhatsApp, CustomerRequest, protected images, authentication/permissions, subscriptions/suspension/reactivation, analytics и SEO/private noindex. Favorites не объявляется работающим: остаётся явно недоступным. Публичная структура сохранена за исключением удаления перечисленных пользователем категорий. FTS/index eligibility и выборочный analytics SQL plan проходят существующие integration проверки; production-нагрузка не моделировалась.

## Known Problems / Известные проблемы

Проваленных итоговых gate-проверок PHASE 8B нет. Реальный Halyk checkout/callback/recurring остаётся выключен из-за незавершённой PHASE 7B. Физическая мобильная камера, полный offline-device сценарий, screen-reader/contrast certification и независимый нагрузочный/security аудит не выполнены локальной проверкой.

## Technical Debt / Технический долг

Изображения незавершённого черновика до upload доступны только в том же браузере; между устройствами переносится серверная текстовая часть. Не добавлялись обходы auth, production mocks или дубли analytics/payment модулей. Скрипт UX-preview — test-only, требует `_test` DB; для интерактивного завершения запускать в TTY и отправить `stop`, при прерывании использовать `--cleanup <runUUID>` только для своего тестового запуска.

## Production Blockers

1. Отдельный PHASE 7B NO-GO: нужны подтверждённые merchant settings/credentials, банковский callback verification contract и acceptance; см. `phase-7b-payment-audit.md`. Эта фаза его не подменяет.
2. Реальный initial admin должен лично сменить пароль и включить 2FA; до этого privileged endpoints закрыты.
3. Production secrets, KZ infrastructure/backup/restore, HTTPS/domain и эксплуатационный запуск cleanup должны быть подготовлены перед публичным запуском. Локальная dev конфигурация для production не подходит.

## Next Recommended Phase / Следующая рекомендуемая фаза

Сначала завершить личную настройку SUPER_ADMIN и отдельно закрыть банковские blockers PHASE 7B. PHASE 9 — только по новому явному заданию пользователя; автоматически не выполнялась.
