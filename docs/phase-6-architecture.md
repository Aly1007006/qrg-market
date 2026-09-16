# PHASE 6 — Admin Area и модерация

## Границы

Отдельные `/admin` и `/admin/login`, серверный Next BFF `/api/admin/*`, Nest `/api/v1/admin/*`. Seller cookie не даёт административного доступа. Frontend не имеет доступа к PostgreSQL. Существующий Next/Nest/Drizzle foundation и дизайн сохранены. Подписки, платежи и PHASE 7 не реализованы. Внешняя публикация не выполнялась.

## Авторизация и MFA

`users → admin_accounts → admin_sessions → permission → resource`, с повторной транзакционной проверкой пользователя, доступа и срока сессии при выполнении операции. ADMIN — отдельная запись, не seller role. Ни signup, ни seller API не принимают административные права. Нет API назначения ADMIN или изменения audit log.

- Все администраторы имеют чтение очереди; `can_moderate`, `can_suspend`, `can_read_audit` выдаются отдельно и по умолчанию false.
- Пароль проверяется существующим Argon2id. Второй фактор реализован через `AdminSecondFactor` и реальный TOTP, обязателен также в development/test. Нет bypass-кода или mock в production.
- TOTP: 20 случайных байт минимум, SHA-1, 6 цифр, 30 секунд, окно ±1. Принятый временной шаг сохраняется под блокировкой; повтор и конкурентный replay запрещены. Используется [официальная библиотека OTPAuth](https://github.com/hectorm/otpauth), её [TOTP API](https://hectorm.github.io/otpauth/classes/TOTP.html).
- Seed хранится только в AES-256-GCM ciphertext со случайным nonce и AAD, привязанным к user UUID. Ключ `ADMIN_MFA_ENCRYPTION_KEY` — canonical base64 32 случайных байт, передаётся secret manager. Пустой/неверный ключ закрывает вход, а не отключает MFA.
- Opaque token 256 бит, в БД только SHA-256. Отдельная cookie `__Host-qrg_admin` в production (`qrg_admin` локально), HttpOnly, SameSite=Strict, Secure production, Path=/, без Domain.
- Абсолютный срок — 1 час, idle timeout — 15 минут. Rotation меняет token/CSRF, но не продлевает абсолютный срок. Новый MFA login отзывает предыдущие admin sessions. Logout, отключение ADMIN, password reset и revoke-all закрывают доступ.
- Login ограничен PostgreSQL limiter: 30 попыток на socket IP и 5 на нормализованный email за 15 минут. Не доверяем X-Forwarded-For. За текущим BFF IP quota общая; настройка доверенной proxy identity остаётся обязательной до production.
- Мутации требуют точный доверенный Origin, JSON, custom header, а после входа — session-bound CSRF. BFF пересылает только admin cookie, ограничивает маршруты/методы, payload 8 KiB и timeout. Все данные private/no-store, страницы noindex.

## Создание и отзыв первого ADMIN

Нет default admin, скрытого bootstrap endpoint или опубликованных паролей. Оператор использует CLI на доверенном хосте с доступом к БД. Настоящие credentials не передаются в чат, аргументы команд или git.

1. Выбрать существующий UUID пользователя после независимой проверки личности. У пользователя должен быть собственный сильный пароль. Для администратора предпочтительна отдельная учётная запись, не состоящая в проверяемом магазине.
2. В secret manager создать случайный 32-byte ключ `ADMIN_MFA_ENCRYPTION_KEY`, настроить одинаковое значение для API и provisioning процесса. Обеспечить защищённое резервирование ключа в Казахстане; его потеря блокирует дешифрование seed.
3. Через доверенный процесс enrollment создать отдельный случайный base32 TOTP seed (не менее 20 байт), передать администратору безопасным каналом в authenticator. Нужен текущий код для подтверждения владения.
4. Передать CLI через окружение из secret manager:

| Переменная                  | Значение                                                       |
| --------------------------- | -------------------------------------------------------------- |
| DATABASE_URL / DATABASE_SSL | Целевая БД и обязательный TLS production                       |
| NODE_ENV                    | production на production-хосте                                 |
| ADMIN_MFA_ENCRYPTION_KEY    | Ключ шифрования из secret manager                              |
| ADMIN_PROVISION_USER_ID     | Проверенный существующий UUID v4                               |
| ADMIN_PROVISION_OPERATOR    | Идентификатор оператора: буквы/цифры/точка/дефис/подчёркивание |
| ADMIN_PROVISION_ACTION      | grant либо revoke                                              |
| ADMIN_PROVISION_TOTP_SECRET | Base32 seed для grant                                          |
| ADMIN_PROVISION_TOTP_CODE   | Текущий шестизначный код для grant                             |
| ADMIN_PROVISION_MODERATE    | true только при разрешении APPROVE/REQUEST_CHANGES/REJECT      |
| ADMIN_PROVISION_SUSPEND     | true только при разрешении SUSPEND                             |
| ADMIN_PROVISION_AUDIT       | true только при разрешении чтения audit log                    |

5. Из корня checkout выполнить `pnpm admin:provision`; в собранном API image — `node apps/api/dist/admin/provision-main.js`. CLI не печатает secrets. Все флаги по умолчанию false. Повторный grant заменяет seed и права, отзывает сессии, пишет аудит. После enrollment для входа дождаться следующего TOTP шага: enrollment-код уже использован.
6. Для отзыва задать action=revoke, UUID и operator; seed/код не требуются. Доступ и сессии отзываются транзакционно, audit сохраняется. После завершения не оставлять enrollment seed/код в окружении интерактивного процесса.

Recovery — только через повторную проверку личности оператором и повторный grant с новым seed; аварийного обхода MFA нет. UI самостоятельного enrollment/recovery и автоматическая ротация encryption key не реализованы. При ротации ключа нужен контролируемый процесс повторного enrollment; нельзя просто заменить ключ и ожидать сохранения входа старых seed.

## Модерация

Seller owner отправляет собственный магазин через `POST /api/v1/shops/:shopId/verification`. Требуются адрес и хотя бы один контактный телефон. Только DRAFT/CHANGES_REQUESTED/REJECTED → PENDING_VERIFICATION. В один момент не более одного открытого moderation case на магазин.

| Действие        | Исходное состояние                                | Результат         |
| --------------- | ------------------------------------------------- | ----------------- |
| APPROVE         | PENDING_VERIFICATION                              | VERIFIED          |
| REQUEST_CHANGES | PENDING_VERIFICATION, VERIFIED, ACTIVE, SUSPENDED | CHANGES_REQUESTED |
| REJECT          | PENDING_VERIFICATION                              | REJECTED          |
| SUSPEND         | PENDING_VERIFICATION, VERIFIED, ACTIVE            | SUSPENDED         |

Все решения проверяют expectedStatus и соответствие caseId текущему магазину. SELECT FOR UPDATE сериализует конкурирующие решения. Статус, закрытие case, moderation_history и SUCCESS audit записываются одной транзакцией. Service-отказы отдельно записывают FAILED; guard-отказы — DENIED. Запросы, отвергнутые validation/Origin middleware до действия, не считаются выполненным решением.

Причина обязательна для REQUEST_CHANGES/REJECT/SUSPEND, plain text до 2000 символов. Seller видит историю только своего магазина. Администратор не может модерировать магазин, в котором состоит участником. Нельзя подставить другой caseId или принять body role/owner/status как права.

Название, адрес и контакты блокируются для seller при PENDING_VERIFICATION/VERIFIED/ACTIVE, чтобы не подменить проверяемые сведения. Для изменения администратор возвращает магазин на доработку; товары и availability продолжают управляться через прежние tenant permissions. APPROVE никогда не даёт ACTIVE. Только ACTIVE доступны в публичном API; SUSPEND скрывает магазин без удаления данных.

## База, аудит и эксплуатация

Миграция `0005_smart_invisible_woman.sql`: admin_accounts, admin_sessions, moderation_cases, moderation_history, audit_logs; UUID, timestamps, FK, CHECK, индексы, partial unique открытого case, hash uniqueness. Срок admin session ограничен CHECK одним часом.

Audit содержит actor, action, resource/resource_id, created_at, result. Не содержит body, email, телефон, пароль, token или seed. Event UUID не имеют каскадных FK: удаление live user/shop не стирает событие. Live sessions/cases сохраняют необходимые FK. Audit/history запрещают UPDATE/DELETE/TRUNCATE триггерами; HTTP edit/delete отсутствуют.

Эта защита не обещает неизменность против DBA/superuser, способного менять DDL. Production runtime DB role должен быть non-superuser, не владельцем schema/таблиц/функций, без прав ALTER/роль migrator; миграции выполняются отдельной ограниченной эксплуатационной ролью. Для audit/history runtime нужны только SELECT/INSERT. Local Compose использует отдельные development credentials и не является production конфигурацией.

`pnpm db:cleanup` удаляет batches до 1000 истёкших более 30 дней admin sessions, не затрагивая audit/history/пользователей/магазины. Планирование job — задача deployment, фоновый scheduler не создавался. Test fixtures используют только `_test` DB и случайные UUID; неизменяемые синтетические audit/history остаются в test DB намеренно.

До production необходимо утвердить сроки хранения/архивирование аудита и moderation reasons (свободный текст может содержать персональные данные), настроить private DB, TLS, secret manager, мониторинг, часы/NTP и независимый encrypted backup/restore test в Казахстане. Документ не заменяет юридическую проверку или фактический restore test.
