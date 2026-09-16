# PHASE 6 — отчёт

Дата финальной проверки: 10 сентября 2026. Выполнена только PHASE 6; PHASE 7 не запускалась.

## Сделано

- Отдельная Admin Area: вход, dashboard с реальными счётчиками, список/очередь магазинов, карточка проверки, последние 50 событий модерации, постраничный read-only audit log. Существующая дизайн-система сохранена; sites-building использован для согласованного интерфейса и доступных форм, без переноса приложения на другой стек/хостинг.
- Реальная обязательная TOTP 2FA через заменяемый `AdminSecondFactor`, шифрование seed AES-256-GCM, защита от replay, отдельная opaque admin session с hash в БД, 1 час absolute / 15 минут idle, rotation/logout/revoke.
- Раздельные permissions на модерацию, приостановку и чтение аудита. Выдача/отзыв ADMIN — только операторским CLI с подтверждённым TOTP enrollment; нет default admin и HTTP self-grant.
- Owner отправляет собственный магазин на проверку. APPROVE → VERIFIED; REQUEST_CHANGES/REJECT/SUSPEND требуют причину. Причины видны продавцу только своего магазина. Проверяемые название/адрес/контакты защищены от подмены.
- Решения транзакционные, с проверкой статуса/caseId, tenant isolation и запретом самопроверки своего магазина. Только ACTIVE публичен; автоматической активации нет.
- Неизменяемые audit/history, безопасная очистка истёкших admin sessions, OpenAPI, CI и эксплуатационная инструкция.

## Изменённые файлы

Основные группы:

- `apps/api/src/admin/{auth,security,metadata,guards,audit,moderation,controller,dto,provision-main}.ts`.
- `apps/api/src/db/schema.ts`, `apps/api/src/db/cleanup.ts`, migration `0005_smart_invisible_woman.sql`, Drizzle journal/snapshot.
- `apps/api/src/app.module.ts`, `http.ts`, `auth/{guards,service}.ts`, `shops/service.ts`, `catalogue/seller.service.ts`.
- `apps/web/app/admin/**`, `apps/web/app/api/admin/[...path]/route.ts`, `lib/admin/**`, `lib/moderation.ts`, `components/admin/forms.tsx`.
- `apps/web/components/seller/verification.tsx`, seller page/BFF allowlist, `app/globals.css`.
- `apps/api/test/admin.*.test.ts`, `apps/web/test/admin.test.ts`, existing auth/catalog integration fixtures, `scripts/admin-smoke.mjs`.
- package scripts, `pnpm-lock.yaml` (OTPAuth 9.5.2), `.github/workflows/ci.yml`, `.env.example`, API environment examples, `compose.yaml`, README и `docs/phase-6-architecture.md`.

Git не имел tracked baseline: существующие файлы остаются untracked, commit/reset не выполнялись. Предыдущие рабочие части не переписывались.

## Database

Созданы `admin_accounts`, `admin_sessions`, `moderation_cases`, `moderation_history`, `audit_logs` с FK, CHECK, timestamps и индексами. UNIQUE hash admin token и partial UNIQUE открытого moderation case. Append-only UPDATE/DELETE/TRUNCATE triggers для audit/history; updated_at triggers для admin accounts/sessions.

Миграция 0005 применена в `qrg_market_test` и основной **локальной** `qrg_market`. В обоих журналах по 6 миграций. До обновления основной БД было 5. В основной БД не создано ни одного ADMIN или moderation case; настоящие пользователи/магазины не изменялись. Volumes сохранены. Production БД не затрагивалась.

У event identifiers намеренно нет каскадных FK: аудит сохраняется при удалении live entity. Защита триггерами не защищает от DBA, способного менять DDL; production runtime role не должна быть владельцем schema или superuser.

## Security

Проверены seller/user → admin escalation, подмена cookie, role/owner/shop mass assignment, обход маршрутов, IDOR/BOLA, чужой caseId, недостаточные permissions и self-moderation. Проверены Origin/CSRF, cookie flags, отсутствие plaintext tokens/seed в БД и ответах/аудите, MFA replay/brute force, rotation, idle/absolute expiry, отключение ADMIN, revoke-all, операторская выдача/отзыв доступа.

Проверены конфликтующие решения (один успех, второй 409), обязательные причины, публичное сокрытие при SUSPEND, запреты UPDATE/DELETE/TRUNCATE audit/history, отсутствие HTTP удаления аудита. Сохранены security-тесты заявок, auth, S3 uploads, malicious files и tenant permissions.

`pnpm audit --prod --audit-level=high`: известных уязвимостей не найдено. Это проверка advisory database, не утверждение об отсутствии всех возможных уязвимостей.

## Tests

| Команда                    | Результат                                       |
| -------------------------- | ----------------------------------------------- |
| `pnpm test`                | 44/44: 25 API + 19 web                          |
| `pnpm test:db`             | 43/43                                           |
| `pnpm test:admin`          | 13/13                                           |
| `pnpm test:admin:smoke`    | 14/14: 13 повторно + built Admin SSR/BFF flow   |
| `pnpm test:requests:smoke` | 11/11, включая 10 request integration сценариев |
| `pnpm test:seller:smoke`   | 9/9, включая 8 upload/S3 security сценариев     |
| `pnpm test:catalog:smoke`  | 14/14: 13 повторно + built catalog SSR          |
| `pnpm test:smoke`          | 2/2                                             |
| `pnpm test:web:preview`    | 8/8                                             |

Всего **132 различных теста** без повторного учёта suites. Проверки HTTP/SSR/unit/реальная тестовая PostgreSQL/S3; browser-click и визуальный/a11y аудит не выполнялись.

Найдены и исправлены: рендер nullable contacts/case/resource в admin SSR, типизация ожидания CLI в тесте, неверная test assertion для FAILED audit другого администратора. Catalog fixture переведён в DRAFT на время редактирования identity и возвращён в ACTIVE для публичных проверок: это отражает новую обязательную модерацию. Тесты не удалялись и security validation не отключалась.

Fixture live entities удаляются адресно из `_test` DB; синтетический append-only audit/history остаётся там намеренно. Test cleanup истёкших сессий проверяется с rollback. Реальные данные не удалялись.

## Typecheck

`pnpm typecheck`: успешно для обоих приложений. Strict TypeScript сохранён, финальный прогон после исправлений.

## Lint

`pnpm lint`: успешно, ESLint и Prettier. Финальные замечания исправлены без отключения правил.

## Production Build

`pnpm build`: успешно, Next.js и NestJS. Docker API/web images также собраны и запущены **локально**. Readiness 200, `/admin/login` 200, `/admin` без session → 307 на login, admin dashboard API без session → 401, каталог 200. В OpenAPI присутствуют admin/seller-verification routes и отдельные cookie schemes.

Внешний deployment не выполнялся: инфраструктура/данные Казахстана не переносятся в Sites или другое облако в рамках этой фазы.

## Известные проблемы

- Первый настоящий ADMIN не создан и MFA key не установлен. Это намеренное fail-closed состояние; перед использованием оператор должен выполнить [инструкцию enrollment](phase-6-architecture.md). Secrets нельзя присылать в чат или commit.
- Production private DB/TLS, non-owner runtime role, secret manager, мониторинг и проверенные KZ backup/restore всё ещё не настроены. Локальный Docker не заменяет production готовность.
- За BFF сохраняется общая socket-IP quota; trusted proxy identity нужно настроить до публичного запуска. Это ограничение теперь относится и к admin login.
- Сохраняются ограничения предыдущих фаз: reset delivery/CAPTCHA provider не подключены, privacy-реквизиты и сроки хранения заявок требуют решения владельца; production приём заявок по умолчанию закрыт. UI бренда по UUID и добавления сотрудника по user ID не менялся.

## Технический долг

- Автоматические lifecycle/архивирование audit и moderation reasons не реализованы: нужен утверждённый retention policy до production. Удаление не должно обходить append-only защиту приложения.
- Ротация MFA encryption key и восстановление доступа пока выполняются операторским повторным enrollment, без автоматизированного re-encryption workflow. Процесс документирован; обхода MFA нет.
- Перенесённый trusted proxy/identity долг остаётся для корректных индивидуальных лимитов за BFF.

## Следующая рекомендуемая фаза

PHASE 7 — подписка продавца, только после отдельной команды пользователя. Не начата.
