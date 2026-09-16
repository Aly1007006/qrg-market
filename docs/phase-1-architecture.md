# PHASE 1 — database, authentication, authorization

Foundation PHASE 0 сохранён: pnpm monorepo, strict TypeScript, Next.js → NestJS → PostgreSQL, unified errors и structured logs. Frontend и публичные страницы не расширялись. Дополнительные shared packages не понадобились.

## Database

| Таблица               | Назначение и ограничения                                                                                                                                  |
| --------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| users                 | UUID, нормализованный уникальный email, Argon2id hash, disabled_at, timestamps; CHECK для email/hash                                                      |
| sessions              | FK user CASCADE, уникальный SHA-256 token_hash, абсолютный expires_at, revoked_at/rotated_at, timestamps; CHECK hash/expiry, active-user и expiry indexes |
| shops                 | UUID, непустое ограниченное name, status DRAFT по умолчанию, timestamps/status index; owner_id отсутствует                                                |
| shop_members          | FK shop CASCADE и user RESTRICT, UNIQUE(shop_id, user_id), role enum, user/shop index; единственный источник tenant membership                            |
| password_reset_tokens | FK user CASCADE, уникальный SHA-256 hash, expiry и consumed_at; CHECK hash/expiry и indexes                                                               |
| auth_rate_limits      | HMAC key вместо raw IP/email, положительный счётчик и window_ends_at; expiry index                                                                        |

`0000_glorious_grandmaster.sql` создаёт schema и constraints. `0001_ownership_and_timestamps.sql` добавляет updated_at triggers и deferred constraint triggers: у каждого существующего shop ровно один SHOP_OWNER к моменту commit. Partial unique index запрещает двух владельцев; создание shop и owner выполняется одной транзакцией. Удаление user с membership запрещено, чтобы не оставить магазин без владельца. Удаление shop каскадно удаляет membership. HTTP удаления shop/user и transfer ownership в этой фазе отсутствуют.

Даты — timestamptz; проверки expiry и авторизации используют время PostgreSQL. Бизнес-таблицы каталога и платежей не созданы.

## Migrations и обслуживание

Команды выполняются из корня: `pnpm db:generate`, `pnpm db:migrate`, `pnpm db:cleanup`. Runner применяет только новые SQL migrations через Drizzle; advisory lock на выделенном соединении сериализует concurrent runners. Ledger находится в schema `drizzle`. Custom trigger SQL хранится в migration, не генерируется автоматически из TypeScript schema. Применённые migrations не редактировать: корректировки оформлять следующей migration. Destructive rollback автоматически не выполняется.

Local Docker запускает отдельный одноразовый migrate service перед API. В production миграции следует выполнять выделенной ролью с DDL permissions; runtime-роль не должна быть superuser или владельцем schema. Production deployment, роли инфраструктуры и backup/restore в Казахстане ещё не настроены.

Cleanup удаляет максимум 1000 записей каждого типа за вызов с `FOR UPDATE SKIP LOCKED`: reset tokens и rate buckets спустя сутки после expiry, sessions спустя 30 дней после expiry. Активные записи и users/shops не удаляются. Нужен периодический запуск команды на инфраструктуре проекта; планировщик этой фазой не развёрнут. Retention — стартовая операционная политика, не юридическая гарантия соответствия. Логи и backups с персональными данными должны оставаться в разрешённой инфраструктуре Казахстана.

## Authentication

Email служит login identifier, пароль — Argon2id (64 MiB, 3 iterations, parallelism 1, случайная salt). Signup возвращает одинаковый 202 для нового и существующего адреса и не выдаёт сессию. Login возвращает одинаковую 401 для неизвестного адреса, неверного пароля и disabled user. Для неизвестного адреса выполняется dummy Argon2 verify. Одновременно выполняется не более четырёх password hash/verify операций на процесс; перегрузка возвращает 503.

Случайный opaque token содержит 32 bytes entropy. В БД хранится только SHA-256; исходный token передаётся только через Set-Cookie. Срок сессии — 7 дней, абсолютный, без sliding extension. Не более 20 активных сессий на пользователя. Повторный login создаёт новый token и отзывает старую cookie-сессию того же пользователя. Rotation меняет token/hash и CSRF secret без продления expiry; конкурентная rotation имеет одного победителя.

Cookie: `qrg_session` локально, `__Host-qrg_session` в production; HttpOnly, SameSite=Lax, Path=/, без Domain, Secure в production, Max-Age и Expires. Дублированные/некорректные cookie отвергаются. Bearer token и token из body не принимаются.

Защищённая операция повторно проверяет сессию внутри транзакции под user lock: предварительно выполненный guard не даёт права продолжить после revoke/reset. Login и reset используют совместимый порядок блокировок. В логах отсутствуют password/hash/token, email, raw IP, body и headers.

Email ownership verification и UI регистрации не реализованы. До отдельного verification flow нельзя использовать регистрацию как подтверждение принадлежности email или магазина. Созданный shop остаётся private DRAFT.

## HTTP и CSRF

Все unsafe requests требуют точный `Origin: APP_ORIGIN`, `X-QRG-Client: web`, JSON Content-Type; `Sec-Fetch-Site: cross-site` запрещён. Это распространяется на signup/login/reset. Защищённые unsafe requests дополнительно требуют `X-QRG-CSRF`, привязанный к текущей cookie-сессии. CSRF token возвращают login, GET me и rotation; после rotation старый CSRF token недействителен.

Production требует явный HTTPS APP_ORIGIN и случайный AUTH_RATE_LIMIT_SECRET длиной 32–128 символов. Rate limits хранятся в PostgreSQL, атомарно обновляются и fail closed: окна 15 минут, login 60/IP и 10/account, signup/reset request 20/IP и 5/account, reset confirmation 20/IP. IP берётся из socket, X-Forwarded-For не считается доверенным. Email нормализуется до формирования HMAC. Raw IP/email в rate-limit таблице не сохраняются.

Будущий same-origin reverse proxy/BFF должен сохранять и проверять исходный браузерный Origin и передавать cookie/CSRF headers. Нельзя подставлять доверенный Origin для непроверенного запроса. Blanket trust proxy запрещён; точную доверенную proxy chain и корректное rate-limit распределение необходимо настроить при deployment. Сейчас все запросы за одним proxy попадут в общий IP budget. Cross-origin CORS не включён. Локальный Swagger на API origin не предназначен для обхода этих ограничений записи.

## Endpoints

Все пути ниже начинаются с `/api/v1`. Auth guard включён по умолчанию; public только health и явно помеченные auth endpoints.

| Метод и путь                                      | Поведение                                                      |
| ------------------------------------------------- | -------------------------------------------------------------- |
| POST /auth/signup                                 | Public, email/password, 202, без autologin                     |
| POST /auth/login                                  | Public, email/password, 200, cookie + user/session expiry/CSRF |
| GET /auth/me                                      | Текущий user/session и CSRF, без hash/token                    |
| GET /auth/sessions                                | Только собственные sessions                                    |
| POST /auth/logout                                 | Revoke текущей сессии, очистка cookie, 204                     |
| DELETE /auth/sessions/:sessionId                  | Revoke только собственной сессии, 204; чужая 404               |
| POST /auth/sessions/revoke-all                    | Revoke всех собственных сессий, включая текущую, 204           |
| POST /auth/session/rotate                         | Новый token/hash/CSRF с прежним expiry                         |
| POST /auth/password-reset/request                 | Public; 503 без delivery adapter, иначе generic 202            |
| POST /auth/password-reset/confirm                 | Public; одноразовый token и новый password, 204                |
| GET/POST /shops                                   | Собственные магазины / создание DRAFT с owner из сессии        |
| GET/PATCH /shops/:shopId                          | Чтение участником / изменение name владельцем                  |
| GET/POST /shops/:shopId/members                   | Список / добавление существующего user владельцем              |
| GET/PATCH/DELETE /shops/:shopId/members/:memberId | Чтение / изменение staff role / удаление staff владельцем      |

Списки shops/members имеют limit 1–100 (default 20) и offset 0–10000. Неизвестные DTO/query поля отвергаются, action endpoints требуют пустой body. UUID валидируются до SQL; значения параметризованы.

## Tenant authorization

`ShopAuthorization.withShop` — общий authorization boundary: повторная проверка session → membership по authenticated user и requested shop → shop lock → повторное чтение membership после lock → permission → callback с проверенным shop и transaction. Повторное чтение учитывает удаление/смену роли, совершённые во время ожидания lock. Все изменения membership используют этот же boundary. Shop/member операции сериализованы по shop в пользу корректности; оптимизировать locking только после измерений.

| Permission этой фазы         | OWNER | MANAGER | EMPLOYEE |
| ---------------------------- | ----- | ------- | -------- |
| shop.read                    | Да    | Да      | Да       |
| shop.settings.write          | Да    | Нет     | Нет      |
| members.read / members.write | Да    | Нет     | Нет      |

Будущие product/request/content permissions пока не созданы. Роль пользователя вычисляется отдельно для каждого shop. Любая member операция фильтрует одновременно member_id и проверенный shop_id. Чужой tenant возвращает 404, недостаточное разрешение собственного tenant — 403. owner_id/permissions/shop_id из body не принимаются. Role в member DTO означает запрошенную целевую staff role, а не источник полномочий; изменение разрешено только owner, только на MANAGER/EMPLOYEE. Назначение, смена и удаление OWNER через generic member endpoints запрещены.

## Password reset delivery boundary

Reset token — случайные 32 bytes, только hash в БД, expiry 30 минут, single use. Повторный request инвалидирует предыдущие tokens. Confirmation атомарно меняет password, consumes tokens и отзывает все sessions; конкурентный replay отклоняется. Ошибка доставки инвалидирует созданный token, не раскрывая существование адреса в ответе.

`PasswordResetDelivery` — interface для будущего реального email provider. Production implementation по умолчанию явно unavailable: одинаковая 503 для любого адреса до lookup. Никаких фиктивных писем, логирования token или development backdoor. Test capture adapter зарегистрирован исключительно в integration test module. Выбор provider, credentials и integration по актуальной официальной документации остаются отдельной зависимостью; внешний API не выдуман.

## Основания и проверки

Реализация использует официальный [node-argon2](https://github.com/ranisalt/node-argon2) и [Drizzle migrations](https://orm.drizzle.team/docs/migrations); security подход сверен с [OWASP Password Storage](https://cheatsheetseries.owasp.org/cheatsheets/Password_Storage_Cheat_Sheet.html) и [OWASP CSRF Prevention](https://cheatsheetseries.owasp.org/cheatsheets/Cross-Site_Request_Forgery_Prevention_Cheat_Sheet.html).

Автоматические тесты используют реальный PostgreSQL, настоящие HTTP guards и Argon2. Покрыты чужие shop/session/member IDs, body/query mass assignment, horizontal escalation, membership revocation, CSRF, rotation/reset races, replay, expiry, disabled users, constraints, timestamps, pagination, cleanup и rate limits. Они не заменяют независимый production security audit.
