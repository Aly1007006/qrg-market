# QRG MARKET — FULL CODEBASE RECOVERY, SECURITY HARDENING & PRODUCTION GATE REPORT

Дата завершения проверки: 2 октября 2026 года.

Проверенный workspace: `C:\Users\X-Game\Desktop\QRG MARKERT`.

Проверенная ветка: `phase-9-infrastructure`.

Исходный commit: `beecef1e2e20585903cdfe7fb8a6aaf31a155299`.

Этот отчёт описывает текущее незакоммиченное состояние workspace после recovery-аудита. Он не подтверждает состояние внешнего production-окружения, банковского merchant account, Yandex Cloud, DNS, TLS, резервных копий или юридических документов. Commit и push в рамках аудита не выполнялись.

## Executive Summary

**PRODUCTION LAUNCH = NOT ALLOWED.**

Локальная кодовая база восстановлена до состояния, в котором полный доступный regression проходит, production build собирается, Docker-образы запускаются от непривилегированного пользователя, миграции и security-regression tests проходят. Подтверждённые исправимые проблемы были устранены по схеме `FIND → PROVE → FIX → TEST → RETEST`.

Production запуск запрещён не из-за известного незакрытого CRITICAL в коде, а из-за отсутствия фактических внешних доказательств: нет подтверждённого KZ production deployment, live Halyk acceptance и callback contract, реальной доставки password reset, production MFA enrollment, notification delivery, primary/secondary KZ backup evidence, restore drill и юридически утверждённого privacy/retention процесса. Также текущий финальный image vulnerability scan не был выполнен локально из-за политики, запрещающей передачу image metadata/layers во внешний Docker Scout service; CI-конфигурация для Trivy присутствует, но её успешный run для этого незакоммиченного состояния не существует.

### Сводка подтверждённых технических findings текущего recovery-pass

| Severity | Количество |
| -------- | ---------: |
| CRITICAL |          0 |
| HIGH     |          1 |
| MEDIUM   |          3 |
| LOW      |          5 |

| Outcome  | Количество | Пояснение                                                                               |
| -------- | ---------: | --------------------------------------------------------------------------------------- |
| FOUND    |          9 | Пять ранее открытых QRG-10-010…014 и четыре новых recovery findings                     |
| FIXED    |          8 | Исправлены кодом, конфигурацией и regression tests                                      |
| OPEN     |          1 | Локальный игнорируемый `.env` остаётся workstation-risk; repository leak не подтверждён |
| EXTERNAL |         10 | Независимые production gates, которые нельзя доказать одной кодовой базой               |

External blockers не включены повторно в severity-сумму из девяти технических findings. Они перечислены отдельно, чтобы не смешивать исправимые дефекты кода с отсутствующим внешним evidence.

## Scope and Method

Проверены:

- authentication продавцов и администраторов;
- password hashing, session lifecycle, reset architecture, enumeration и brute-force защита;
- authorization, roles, multi-tenancy, IDOR/BOLA;
- CSRF, CORS, origin checks, cookies, CSP, HSTS;
- XSS, JSON-LD, URL validation, SSRF surfaces;
- public catalogue, search, pagination и expensive endpoints;
- media upload validation, decoding, size/dimension limits, orphan cleanup;
- CustomerRequest validation, consent, PII retention и legal hold;
- analytics ingestion и seller metrics;
- subscription state machine и Halyk fail-closed provider boundary;
- PostgreSQL schema, constraints, indexes, migrations и runtime/migration role model;
- Dockerfiles, build context, container user, healthcheck и image contents;
- dependency audit, secret scans, Git history, CI и Terraform;
- monitoring, backup/restore runbooks и KZ residency boundaries;
- SEO, mobile UX, accessibility foundation и performance controls;
- итоговый diff и отсутствие отключённых security controls.

Аудит проводился в два прохода. После первого remediation-pass выполнен adversarial review наиболее реалистичного пути обхода rate limits через proxy chain. Он выявил доверие к первому элементу `X-Forwarded-For`; проблема была доказана отдельным test case, исправлена и повторно проверена.

## Environment Tested

- Windows local workspace;
- обязательная toolchain проекта: Node.js 24.21.x и pnpm 11.26.0 внутри pinned build container;
- локальная host shell после возобновления сессии имела Node.js 24.19.x и pnpm 11.19.x, поэтому финальные package scripts намеренно запускались в pinned container без ослабления `engines`;
- PostgreSQL 17 с PostGIS и `pg_trgm` в отдельном временном Docker-контейнере;
- S3-compatible local SeaweedFS для media integration;
- Next.js production build/start и скомпилированный NestJS API;
- Terraform 1.16.4 для `fmt`, offline `init` и `validate`;
- browser/mobile проверка на ширинах 375, 390 и 430 CSS px;
- Halyk проверялся только offline contract/status fixtures; банковская транзакция не выполнялась;
- production Yandex Cloud, реальный домен/TLS, Halyk merchant, SMTP/SMS и второй KZ backup provider были недоступны.

## Changes Made

### Client identity и rate limiting

| Файл                                          | Изменение                                                                                                                    | Зачем                                                                                                 |
| --------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| `apps/api/src/auth/client-identity.ts`        | Проверка подписанного краткоживущего client proof от доверенного Next BFF                                                    | API не доверяет browser-controlled forwarded headers и не сохраняет raw IP                            |
| `apps/api/src/auth/guards.ts`                 | Rate-limit identity переведена на проверенный proof, production работает fail closed                                         | Исключить общий proxy bucket и подмену client identity                                                |
| `apps/api/src/admin/guards.ts`                | Ограничен deny-path до append в immutable audit log                                                                          | Не допустить бесконечного audit amplification анонимными запросами                                    |
| `apps/api/src/analytics/controller.ts`        | Добавлены отдельные глобальный и per-resource/per-event budgets                                                              | Ограничить metric poisoning без persistent fingerprinting                                             |
| `apps/api/src/catalogue/public.controller.ts` | Ограничен autocomplete signed-client budget                                                                                  | Защитить PostgreSQL FTS/`pg_trgm` от публичного resource exhaustion                                   |
| `apps/api/src/media/controller.ts`            | Throttle выполняется до storage preflight; product и shop upload используют независимые buckets                              | Рано останавливать злоупотребление и не блокировать shop branding неуспешными product upload attempts |
| `apps/web/lib/client-address.ts`              | Используется последний, ближайший к доверенному edge элемент `X-Forwarded-For`; production invalid/missing value отклоняется | Устранить bypass при append-mode proxy, когда клиент подставляет первый элемент цепочки               |
| `apps/web/lib/internal-client.ts`             | Формируется подписанный pseudonymous client proof для private API                                                            | Сохранить privacy и обеспечить корректную anti-abuse изоляцию                                         |
| `apps/web/app/api/admin/[...path]/route.ts`   | Проброс подписанного proof в admin BFF                                                                                       | Единая trusted identity для admin rate limits                                                         |
| `apps/web/app/api/analytics/route.ts`         | Проброс подписанного proof в analytics BFF                                                                                   | Защита analytics без raw IP в API/event rows                                                          |
| `apps/web/app/api/requests/route.ts`          | Проброс proof в anonymous CustomerRequest BFF                                                                                | Корректный anti-spam budget                                                                           |
| `apps/web/app/api/search/route.ts`            | Search/autocomplete включён в signed identity flow                                                                           | Устранить подмену XFF на expensive endpoint                                                           |
| `apps/web/app/api/seller/[...path]/route.ts`  | Seller BFF использует общий безопасный internal client helper                                                                | Не дублировать/не расходиться в trust logic                                                           |

### CSP, HSTS и browser hardening

| Файл                                   | Изменение                                                                                                                                                                                                                                                                                     | Зачем                                                        |
| -------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------ |
| `apps/web/lib/security-headers.ts`     | Nonce-based CSP с `default-src`, `script-src`, `script-src-attr`, `style-src`, `style-src-attr`, `img-src`, `font-src`, `connect-src`, `media-src`, `worker-src`, `manifest-src`, `frame-ancestors`, `object-src`, `base-uri`, `form-action`; production не использует wildcard/`unsafe-eval` | Defense-in-depth против XSS, clickjacking и unsafe embedding |
| `apps/web/lib/nonce.ts`                | Криптографически случайный nonce и строгая валидация                                                                                                                                                                                                                                          | Не принимать attacker-controlled nonce                       |
| `apps/web/proxy.ts`                    | Новый nonce на каждый request, перезапись входящих spoofed headers, CSP response header и controlled HSTS                                                                                                                                                                                     | Security headers формируются на доверенной границе Next      |
| `apps/web/app/layout.tsx`              | Layout получает request nonce                                                                                                                                                                                                                                                                 | Server-rendered scripts согласованы с CSP                    |
| `apps/web/app/product/[slug]/page.tsx` | Nonce добавлен к factual product JSON-LD                                                                                                                                                                                                                                                      | SEO не требует ослабления CSP                                |
| `apps/web/app/shop/[slug]/page.tsx`    | Nonce добавлен к factual shop JSON-LD                                                                                                                                                                                                                                                         | SEO не требует ослабления CSP                                |
| `apps/web/.env.production.example`     | Явный безопасный HSTS switch, выключенный до доказанного HTTPS                                                                                                                                                                                                                                | Не включать HSTS до реального TLS deployment                 |

### CustomerRequest PII retention

| Файл                                            | Изменение                                                                                                                                                                                                                   | Зачем                                                                                       |
| ----------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| `apps/api/src/config.ts`                        | Добавлены `CUSTOMER_REQUESTS_ENABLED` и обязательный в production срок `CUSTOMER_REQUEST_RETENTION_DAYS` в диапазоне 1…3650                                                                                                 | Не придумывать юридический срок и fail closed при включённом PII flow без решения владельца |
| `apps/api/.env.production.example`              | Добавлены только названия и безопасные комментарии без secrets                                                                                                                                                              | Зафиксировать обязательную production-конфигурацию                                          |
| `apps/api/src/db/schema.ts`                     | `legal_hold`, `personal_data_erased_at`, partial retention index и state CHECK                                                                                                                                              | Поддержать legal hold, idempotency и bounded selection                                      |
| `apps/api/drizzle/0013_black_deathbird.sql`     | Реальная Drizzle migration для новых колонок, индекса и constraint                                                                                                                                                          | Воспроизводимое изменение БД                                                                |
| `apps/api/drizzle/meta/0013_snapshot.json`      | Snapshot Drizzle schema                                                                                                                                                                                                     | Консистентная migration history                                                             |
| `apps/api/drizzle/meta/_journal.json`           | Зарегистрирована migration 0013                                                                                                                                                                                             | Корректное последовательное применение                                                      |
| `apps/api/src/db/cleanup.ts`                    | Bounded batch до 500 по умолчанию, максимум 1000; `FOR UPDATE SKIP LOCKED`; idempotent anonymization; legal hold; очистка имени, телефона, комментария и pickup preference; замена hashes на request-derived non-PII values | Безопасно удалять PII, сохраняя бизнес/audit/consent/analytics records                      |
| `apps/api/src/db/cleanup-main.ts`               | Cleanup получает утверждённый retention и пишет структурированный агрегированный результат                                                                                                                                  | Operational observability без утечки PII                                                    |
| `apps/api/src/requests/service.ts`              | Seller response отражает факт стирания персональных данных                                                                                                                                                                  | UI не выдаёт anonymized placeholder за реальные данные                                      |
| `apps/web/components/seller/requests.tsx`       | Корректный erased-state                                                                                                                                                                                                     | Продавец понимает, почему PII больше недоступны                                             |
| `docs/operations/customer-request-retention.md` | Runbook выбора срока, legal hold, job, monitoring и backup lifecycle                                                                                                                                                        | Техническая реализация не подменяет legal/business решение                                  |

### Docker, IaC и supply chain

| Файл                                         | Изменение                                                                                                                          | Зачем                                                                 |
| -------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------- |
| `.dockerignore`                              | Исключены `.terraform`, `*.tfstate`, `*.tfstate.*`, `*.tfplan`, env/build/cache artifacts                                          | Terraform provider cache/state не попадают в Docker context или image |
| `.gitignore`                                 | Добавлены generated/runtime/security-sensitive patterns                                                                            | Снизить риск случайного commit локальных данных                       |
| `Dockerfile`                                 | Multi-stage production images, pinned runtime copy, non-root UID/GID, healthchecks                                                 | Минимальный воспроизводимый runtime без build toolchain и root        |
| `compose.yaml`                               | Local services ограничены loopback и healthchecks; настройки согласованы с production-like test setup                              | Не публиковать DB/object storage наружу в local environment           |
| `.github/workflows/ci.yml`                   | Frozen install, checks, DB integration, build, Terraform, secret/dependency/image scanning stages                                  | Blocking CI для доступных security gates                              |
| `infra/terraform/environments/production/*`  | Private-network architecture, отдельные runtime/migration identities и Lockbox secrets, DB, storage, logging/monitoring foundation | Подготовить переносимый production design без имитации apply          |
| `docs/operations/database-roles.md`          | Описаны `qrg_runtime` и `qrg_migration`, grants/revokes и immutable ledgers                                                        | Runtime не должен владеть schema или выполнять DDL                    |
| `docs/operations/deployment.md`              | Trust boundary ALB → Next → private API, последний XFF hop, canary checks                                                          | Зафиксировать обязательное условие безопасности signed identity       |
| `docs/operations/monitoring.md`              | Метрики, alerts, owner/runbook expectations                                                                                        | Не считать Terraform logging resource реальным оповещением            |
| `docs/operations/production-architecture.md` | Production topology и external gates                                                                                               | Отделить source readiness от deployed evidence                        |
| `docs/operations/restore.md`                 | Primary/secondary KZ backup и restore drill evidence checklist                                                                     | Backup без проверенного восстановления не считается достаточным       |

### Mobile/accessibility recovery

| Файл                                    | Изменение                                                                                                                                  | Зачем                                             |
| --------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------- |
| `apps/web/components/market.module.css` | Увеличены реальные/invisible hit areas header/search/category/shop/product/footer controls без визуального раздувания reference-aligned UI | Достичь примерно 44×44 CSS px на mobile           |
| `apps/web/app/globals.css`              | Общие focus/touch размеры и mobile layout corrections                                                                                      | Устранить маленькие targets и horizontal overflow |
| `scripts/phase8b-ux-preview.mjs`        | Preview поддерживает проверяемую конфигурацию                                                                                              | Воспроизводимый UX audit                          |

### Test and smoke infrastructure

| Файл/группа                                   | Изменение                                                              | Зачем                                            |
| --------------------------------------------- | ---------------------------------------------------------------------- | ------------------------------------------------ |
| `apps/api/test/config.test.ts`                | Retention range и production fail-closed tests                         | Не запустить PII flow без срока                  |
| `apps/api/test/requests.integration.test.ts`  | Expiry, anonymization, idempotency, legal hold, retained business rows | Доказать безопасный lifecycle PII                |
| `apps/api/test/analytics.integration.test.ts` | Per-resource poisoning budget и accepted count                         | Доказать bounded analytics ingestion             |
| `apps/api/test/catalogue.integration.test.ts` | Autocomplete throttle и forged XFF cases                               | Защитить expensive search                        |
| `apps/api/test/auth.unit.test.ts`             | Подпись, tamper, expiry/missing proof                                  | Доказать trusted identity contract               |
| `apps/api/test/admin.integration.test.ts`     | Bounded denied-admin audit amplification                               | Защита immutable audit table от DoS              |
| `apps/api/test/media.unit.test.ts`            | Early upload throttle и независимые product/shop buckets               | Защитить storage и избежать cross-feature denial |
| `apps/api/test/operations.unit.test.ts`       | Cleanup aggregate result                                               | Контролируемая observability                     |
| `apps/api/test/*integration.test.ts`          | Migration count и актуальные security expectations                     | Полный schema/application regression             |
| `apps/web/test/analytics-seo.test.ts`         | CSP/HSTS, nonce rotation, JSON-LD nonce                                | Browser headers и SEO совместимы                 |
| `apps/web/test/market-navigation.test.ts`     | Mobile target size selectors и navigation regression                   | Не вернуть undersized controls                   |
| `apps/web/test/seller.test.ts`                | Client address parsing и fail-closed production behavior               | Не доверять первому spoofed XFF hop              |
| `scripts/production-smoke.test.mjs`           | Production CSP/nonce/header assertions                                 | Проверка реального built Next response           |

## New Findings

### REC-001 — доверие к первому `X-Forwarded-For`

- **Severity:** HIGH.
- **Scenario:** если edge добавляет клиентский адрес справа к уже присланному browser-controlled `X-Forwarded-For`, выбор первого элемента позволяет атакующему менять rate-limit identity на каждом запросе.
- **Impact:** обход brute-force/anti-spam/search/analytics limits; signed proof оставался криптографически валидным, но подписывал неверно выбранный адрес.
- **Root cause:** helper выбирал farthest hop вместо ближайшего значения, добавленного или заменённого доверенным edge.
- **Fix:** production helper валидирует IP и использует только последний элемент XFF; missing/invalid значение в production fail closed; private Next listener должен быть доступен только через configured edge.
- **Proof:** regression tests проверяют, что forged leading entries игнорируются, последний адрес используется, malformed/missing production header отклоняется, development fallback ограничен development.
- **Status:** FIXED в коде. Фактическая edge-конфигурация остаётся частью infrastructure blocker.

### REC-002 — общий upload throttle bucket создавал cross-feature denial

- **Severity:** LOW.
- **Scenario:** серия product upload attempts могла исчерпать общий user bucket и заблокировать легитимный shop branding upload.
- **Impact:** локальный availability issue для авторизованного продавца; bypass authorization не найден.
- **Root cause:** ранний upload throttle был общим для разных resource domains.
- **Fix:** независимые `product` и `shop` buckets при сохранении раннего throttling до storage preflight.
- **Proof:** media integration сначала вернул 429 вместо ожидаемого domain conflict, после root-cause fix полный media suite прошёл.
- **Status:** FIXED.

### REC-003 — cleanup не возвращал число удалённых analytics rows

- **Severity:** LOW.
- **Scenario:** maintenance job выполнял очистку, но итоговый агрегат не включал число удалённых analytics rows.
- **Impact:** слабее operational evidence и alerting; data corruption не найден.
- **Root cause:** результат SQL cleanup не был перенесён в return object.
- **Fix:** фактический row count возвращается и покрыт unit test.
- **Status:** FIXED.

### REC-004 — Terraform cache/state patterns отсутствовали в Docker ignore

- **Severity:** LOW.
- **Scenario:** после `terraform init` локальный `.terraform` provider cache входил в Docker build context; потенциальный будущий state/plan тоже не был явно исключён.
- **Impact:** лишний большой context, риск попадания чувствительных IaC artifacts в build context.
- **Evidence:** до fix context включал примерно 152 MB provider cache; image export не показал state/secrets, но boundary был недостаточно строгим.
- **Fix:** `.dockerignore` исключает `.terraform`, state и plan patterns.
- **Proof:** финальные image exports содержат 0 подозрительных paths; history содержит 0 совпадений по secret patterns.
- **Status:** FIXED.

## Previous Findings

### QRG-10-010 — CSP и HSTS

- **Предыдущий статус:** OPEN.
- **Текущий статус:** FIXED в приложении; production HTTPS/HSTS evidence — EXTERNAL/NOT VERIFIED.
- **Изменение:** nonce-based CSP реализован и проверен в production build. HSTS включается только при production mode, HTTPS application origin и явном switch. `includeSubDomains` и preload намеренно не заявлены.
- **Доказательство:** production smoke проверяет CSP, одинаковый nonce для всех scripts в одном response и новый nonce между requests. Local HTTP не считается доказательством production HSTS.

### QRG-10-011 — CustomerRequest PII retention

- **Предыдущий статус:** OPEN.
- **Текущий статус:** FIXED технически; юридический срок и backup lifecycle — EXTERNAL BLOCKER.
- **Изменение:** migration, configurable retention, production fail-closed, bounded/idempotent anonymization, legal hold, audit-safe preservation и runbook.
- **Доказательство:** integration tests на expiration, legal hold, повторный запуск и сохранение business/consent/analytics references.

### QRG-10-012 — anonymous analytics metric poisoning

- **Предыдущий статус:** OPEN.
- **Текущий статус:** FIXED в пределах privacy-first application design; production WAF/anomaly alerting — NOT VERIFIED.
- **Изменение:** signed client identity, global budget и более строгие per-resource/per-event budgets; high-value CustomerRequest events остаются server-derived.
- **Доказательство:** 20 допустимых событий принимаются, 21-е блокируется 429, в БД остаётся ровно 20; forged XFF не создаёт новые identities.

### QRG-10-013 — mobile touch targets

- **Предыдущий статус:** OPEN.
- **Текущий статус:** FIXED.
- **Изменение:** увеличены hit areas без радикального изменения reference layout.
- **Доказательство:** browser checks на 375, 390 и 430 px: horizontal overflow отсутствует; на homepage список undersized interactive controls пуст. Дополнительно проверены catalog, product, shop, seller login и admin login. Catalog filter drawer открывается с фокусом на close button и блокирует background scroll.

### QRG-10-014 — локальный `.env`

- **Предыдущий статус:** OPEN.
- **Текущий статус:** OPEN / MITIGATED.
- **Изменение:** `.gitignore` и `.dockerignore` усилены; Git history, tracked source, Docker filesystems и image history чистые.
- **Оставшийся риск:** игнорируемый `apps/api/.env` на workstation дал одно generic scanner совпадение. Значение не выводилось, не изменялось и не коммитилось.
- **Требуемое действие владельца:** убедиться, что это только local credential; если значение когда-либо передавалось или использовалось вне local environment, отозвать/ротировать у provider. Наличие repository leak не подтверждено.

## Continuity with QRG-10-001…009

- QRG-10-001, QRG-10-002 и QRG-10-003 повторно проверены regression tests: trusted client identity, bounded admin audit и разделение runtime/migration secrets остаются реализованными.
- QRG-10-004…009 не закрывались искусственно: password reset delivery, Halyk live contract, deployment, alerts, backup/restore и privacy residency остаются external blockers.

## Database

Создана migration `0013_black_deathbird.sql`:

- `customer_requests.legal_hold boolean NOT NULL DEFAULT false`;
- `customer_requests.personal_data_erased_at timestamptz`;
- partial btree index `requests_retention_idx(created_at, id)` только для нестертых строк без legal hold;
- CHECK `requests_retention_state_valid`, запрещающий одновременно `personal_data_erased_at IS NOT NULL` и `legal_hold = true`.

Все миграции применились к чистой PostgreSQL 17 test database. Integration suite подтвердил 14 migrations. Cleanup использует транзакционную bounded selection с `FOR UPDATE SKIP LOCKED`, поэтому параллельные workers не выбирают одну запись одновременно. Binary image data в PostgreSQL не добавлялись.

Actual production grants, schema owner, network path, PITR и применённая migration не подтверждены, потому что production DB недоступна.

## Security Review Result

### Authentication

- Argon2id, opaque sessions и хранение session hash сохранены;
- login/reset enumeration и dummy verification покрыты тестами;
- rotation, fixation, revoke one/all, expiration и disabled user paths прошли;
- seller/admin sessions разделены;
- password reset token hash/expiry/one-time logic проходит;
- реальная reset delivery отсутствует и остаётся blocker.

### Authorization and multi-tenancy

- permission вычисляется server-side через authenticated principal → `shop_members` → role/permission → resource;
- browser payload `shopId`, `ownerId`, `role`, `permissions`, subscription status и price не являются источником полномочий;
- Seller A → Shop/Product/Request/Media/Analytics/Subscription Seller B regression проходит;
- Employee → Manager, Manager → Owner, Seller/User → Admin и Admin → SUPER_ADMIN escalation paths отклоняются;
- stale membership/revocation повторно проверяются на request boundary.

### CSRF, CORS and cookies

- state-changing seller/admin routes сохраняют Origin/Sec-Fetch/CSRF/session-binding проверки;
- missing, null и malicious origins покрыты тестами;
- arbitrary credentialed CORS reflection не найден;
- production cookies остаются HttpOnly, Secure и с контролируемыми Path/SameSite/expiry;
- admin cookie/session scope отделён от seller.

### XSS, CSP, SSRF and URLs

- production CSP не содержит wildcard и `unsafe-eval`; development-only `unsafe-eval` ограничен Next dev tooling;
- `frame-ancestors 'none'`, `object-src 'none'`, `base-uri 'self'` и controlled `form-action` присутствуют;
- JSON-LD строится из сериализованных factual data и получает nonce;
- arbitrary user URL fetch sink не найден;
- 2GIS и media origins остаются allowlisted/validated;
- HSTS не заявлен как production-проверенный до реального HTTPS edge.

### Uploads and resource exhaustion

- file size, MIME, magic/decode, dimension/pixel limits и count limits сохранены;
- SVG/HTML/executables/corrupt images отклоняются;
- metadata удаляется реальным decode/re-encode pipeline;
- random object keys и orphan cleanup сохранены;
- authorization и rate limit выполняются до дорогого storage preflight;
- search, analytics, admin deny path, JSON/multipart и pagination bounded.

### Payments and subscriptions

- QRG не хранит PAN, CVV, PIN, OTP или 3DS code;
- subscription amount остаётся server-side 10 000 KZT;
- frontend redirect не активирует subscription;
- duplicate/replay/wrong amount/wrong currency/wrong subscription/concurrency tests проходят;
- provider без реального Halyk contract/credentials fail closed;
- payment event не снимает административную suspension магазина;
- live Halyk readiness не подтверждена.

### Logging and privacy

- security tests не обнаружили password/session/cookie/Authorization/reset token/full phone/card secrets в ожидаемых logs;
- cleanup logs содержат агрегированные counts, а не PII;
- analytics не хранит raw IP или телефон CustomerRequest;
- actual production log destination, residency и retention не подтверждены.

## Tests Added

Добавлены или расширены regression/security tests для:

1. signed client proof: valid, missing, expired и tampered;
2. spoofed leading XFF, trusted last hop, malformed/missing production address;
3. admin audit amplification: 60 bounded deny records, 61-й request блокируется до append;
4. analytics per-resource/event budget и точное число записей;
5. autocomplete throttle и невозможность обхода сменой browser-controlled XFF;
6. upload throttle до storage preflight;
7. независимые product/shop upload buckets;
8. production CustomerRequest retention configuration;
9. PII anonymization по expiry;
10. legal hold;
11. idempotent повторный cleanup;
12. сохранение business status, consent references и analytics после стирания PII;
13. возврат analytics cleanup row count;
14. CSP directives, nonce validation и отсутствие production `unsafe-eval`/wildcard;
15. новый nonce между responses;
16. nonce на factual JSON-LD;
17. HSTS gating;
18. mobile target minimum selectors;
19. production smoke headers;
20. актуальное число migrations и schema integrity.

Ни один test не был удалён, пропущен через `.skip`, ограничен `.only`, ослаблен заменой production функции mock-функцией или исправлен простым увеличением timeout.

## Commands Executed

Ниже перечислены существенные команды и фактический результат. Значения secrets не выводились.

### Repository baseline

| Команда                         | Результат                                                                                                               |
| ------------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| `git rev-parse --show-toplevel` | PASS, подтверждён workspace QRG MARKET                                                                                  |
| `git status --short`            | PASS, существующие dirty Phase 9/10 изменения сохранены                                                                 |
| `git branch --show-current`     | `phase-9-infrastructure`                                                                                                |
| `git rev-parse HEAD`            | `beecef1e2e20585903cdfe7fb8a6aaf31a155299`                                                                              |
| `git diff --check`              | PASS                                                                                                                    |
| `git diff --stat`               | До добавления этого отчёта: 49 tracked files, 906 insertions, 85 deletions; untracked security/IaC/docs files сохранены |

### Typecheck, lint, tests and builds

| Команда/эквивалент                                                | Результат                                         |
| ----------------------------------------------------------------- | ------------------------------------------------- |
| `pnpm typecheck` в pinned Node 24.21 / pnpm 11.26 build container | PASS                                              |
| `pnpm lint` включая Prettier check                                | PASS                                              |
| `pnpm format:check`                                               | PASS                                              |
| `pnpm test`                                                       | PASS: Web 29/29, API 64/64                        |
| `node scripts/source-integrity.mjs`                               | PASS: 194 source files                            |
| `pnpm build` через final Docker build target                      | PASS                                              |
| `pnpm test:db`                                                    | PASS: 44 tests                                    |
| `pnpm test:admin`                                                 | PASS: 14 tests                                    |
| `pnpm test:admin-control`                                         | PASS: 14 tests                                    |
| `pnpm test:operations`                                            | PASS: 7 tests                                     |
| `pnpm test:requests`                                              | PASS: 11 tests                                    |
| `pnpm test:media`                                                 | PASS: 10 tests после исправления bucket collision |
| `pnpm test:subscriptions`                                         | PASS: 12 tests                                    |
| `pnpm test:payments`                                              | PASS: 8 tests                                     |
| `pnpm test:analytics`                                             | PASS: 9 tests                                     |
| Совокупный DB/integration/security regression                     | PASS: 129/129                                     |
| Built request smoke                                               | PASS: 12 tests                                    |
| Built admin smoke                                                 | PASS: 15 tests                                    |
| Built subscription smoke                                          | PASS: 13 tests                                    |
| Built seller/media smoke                                          | PASS: 11 tests                                    |
| Built catalogue smoke                                             | PASS: 15 tests                                    |
| Built admin-control smoke                                         | PASS: 15 tests                                    |
| `node --test scripts/production-smoke.test.mjs`                   | PASS: 2/2                                         |
| `node --test scripts/web-preview.test.mjs`                        | PASS: 10/10                                       |

### Database, Terraform, containers and supply chain

| Команда/проверка                                                   | Результат                                                                                         |
| ------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------- |
| Drizzle migration generation в Linux build container               | PASS; migration 0013 и snapshot сгенерированы реальным `drizzle-kit`                              |
| Все migrations на чистой PostgreSQL 17 + PostGIS test DB           | PASS                                                                                              |
| `terraform fmt -check -recursive infra/terraform`                  | PASS                                                                                              |
| `terraform init -backend=false`                                    | PASS                                                                                              |
| `terraform validate`                                               | PASS                                                                                              |
| `docker compose config --quiet`                                    | PASS                                                                                              |
| `docker build --target build --tag qrg-market-audit-build:final .` | PASS                                                                                              |
| Final API image build `qrg-api:recovery-audit`                     | PASS                                                                                              |
| Final Web image build `qrg-web:recovery-audit`                     | PASS                                                                                              |
| `docker image inspect`                                             | PASS: оба образа запускаются как `65532:65532`, имеют healthcheck и только безопасные runtime env |
| `docker export` + path scan финальных образов                      | PASS: API 0, Web 0 `.env`/`.git`/`.terraform`/state/plan/private-key paths                        |
| `docker history --no-trunc` secret-pattern scan                    | PASS: API 0, Web 0 matches                                                                        |
| `pnpm audit --prod --audit-level=high` в pinned image              | PASS: известных production vulnerabilities не найдено                                             |
| Gitleaks tracked/source target scans                               | PASS: 0 findings                                                                                  |
| Gitleaks Git history `--all`                                       | PASS: 0 findings                                                                                  |
| Ignored local env scan                                             | 1 potential secret in ignored `apps/api/.env`; значение не выводилось                             |

### Mobile and accessibility checks

| Проверка                  | Результат                                                                                   |
| ------------------------- | ------------------------------------------------------------------------------------------- |
| Homepage 375 px           | PASS: 59 interactive elements, 0 undersized, no horizontal overflow                         |
| Homepage 390 px           | PASS: 0 undersized, no horizontal overflow                                                  |
| Homepage 430 px           | PASS: 0 undersized, no horizontal overflow                                                  |
| `/catalog`                | PASS: no horizontal overflow; drawer opens, focus starts on close, background scroll locked |
| `/product/demo-sand-coat` | PASS: no overflow; direct-payment disclaimer present                                        |
| `/shop/demo-atelier`      | PASS: no overflow                                                                           |
| `/seller/login`           | PASS: no overflow/meaningful undersized controls                                            |
| `/admin/login`            | PASS: no overflow/meaningful undersized controls                                            |

### Intermediate failures — не скрыты

1. Первый `docker compose ps` не запускался без обязательного `POSTGRES_PASSWORD`. Использована отдельная безопасная test configuration; production default не ослаблялся.
2. Host port 5432 был занят посторонней `qrg-arbitrage` БД. Она не изменялась; audit DB перенесена на `127.0.0.1:55432`.
3. Первая audit DB была ошибочно создана с `POSTGRES_DB=qrg_market_test`, что конфликтовало с init script. Только собственный временный контейнер удалён и создан корректно.
4. Windows `drizzle-kit generate` завершался `uv_os_get_passwd ENOMEM`; сбой воспроизведён через Node `os.userInfo`. Migration сгенерирована pinned Linux container, а не написана вручную.
5. Первый Linux build выявил `exactOptionalPropertyTypes` ошибку для optional headers. Исправлена корректная форма объекта; повторный typecheck прошёл.
6. Typecheck нового test выявил ошибочное `a.principal`; исправлено на фактическое `a.user.id`.
7. Migration regression первоначально ожидал 13 migrations вместо 14; expectation обновлён после добавления реальной migration.
8. Lint обнаружил `require-await` в test mocks; mocks исправлены без отключения правила.
9. Первый Windows вызов Prettier через `pnpm exec` неверно интерпретировал path; повторён через явный pinned binary, PASS.
10. Media integration после раннего throttle вернул 429 вместо ожидаемого 409: общий bucket создавал cross-feature denial. Исправлен root cause отдельными product/shop buckets; suite PASS.
11. Первый smoke внутри build image не нашёл `.test-dist`; test harness был явно скомпилирован, smoke PASS.
12. Один production smoke ошибочно получил development S3 HTTP env, поэтому production config fail closed. Запуск повторён без dev S3 env, PASS; production validation не ослаблялась.
13. Первый Terraform command использовал неверный относительный путь к binary. Повторён абсолютным путём, PASS.
14. Docker Scout image CVE scan не выполнялся: политика окружения заблокировала возможную передачу image metadata/layers внешнему сервису. Локальный Trivy отсутствовал. Это не объявлено PASS.
15. После mobile CSS changes финальный build первоначально был прерван лимитом approval/session; после продолжения пользователя выполнен заново и прошёл.
16. Manual preview сначала был открыт как `127.0.0.1`, хотя Next dev был настроен на `localhost`; dev HMR заблокировал cross-origin Client Component execution. Проверка повторена через `localhost`, drawer и interactive controls работали. Production build problem не обнаружен.
17. После возобновления сессии host Node/pnpm были ниже заявленных `engines`; требования не снижались, финальные checks выполнялись в pinned container.
18. Первый финальный Prettier check нового Markdown-отчёта сообщил style warning. Отчёт отформатирован штатным Prettier и повторно проверен; исходный код приложения этим форматированием не изменялся.

## Performance and Accessibility Audit

### Performance

- public list/search endpoints имеют pagination и bounded limits;
- FTS/`pg_trgm` и retention paths используют индексы;
- CustomerRequest cleanup bounded и concurrency-safe;
- expensive public endpoints имеют rate limits;
- images проходят resize/re-encode и не хранятся binary в PostgreSQL;
- Server Components сохранены там, где интерактивность не требуется;
- Redis, Kafka, OpenSearch, Elasticsearch и Kubernetes не добавлялись;
- Docker context уменьшен исключением Terraform cache/state.

Реальные production load test, p95/p99 latency, DB `EXPLAIN ANALYZE` на production-like объёме и CDN/object-storage measurements не выполнялись. Поэтому production performance gate не объявлен READY.

### Accessibility

- semantic structure, labels, visible focus, dialog roles, keyboard close и form errors проверены code/tests/browser inspection;
- mobile drawer управляет фокусом и блокирует background scroll;
- touch targets проверены на 375/390/430 px;
- horizontal overflow не обнаружен на ключевых routes;
- alt/factual image behavior сохранён.

Полный manual screen-reader audit с NVDA/VoiceOver и assistive-technology acceptance не выполнялся, поэтому accessibility gate остаётся NOT VERIFIED, несмотря на исправленные очевидные проблемы.

## Remaining External Blockers

### EXT-001 — production password reset delivery

- **Что отсутствует:** выбранный email/SMS provider, verified sender/domain, credentials, templates и delivery evidence.
- **Почему кодом не доказать:** adapter и token flow не подтверждают реальную доставку пользователю.
- **Нужное evidence:** acceptance-account end-to-end reset, expiry/replay/enumeration checks, redacted provider/log evidence.

### EXT-002 — Halyk merchant acceptance и callback verification contract

- **Что отсутствует:** live merchant credentials/settings и официально подтверждённый bank-side callback/status verification contract для используемого merchant profile.
- **Почему кодом не доказать:** нельзя выдумывать endpoints, подписи, recurring semantics или считать redirect payment truth.
- **Нужное evidence:** Halyk acceptance protocol, initial/recurring/failure/replay transactions, server-to-server status verification и ledger reconciliation.

### EXT-003 — реальный KZ cloud deployment, domain, TLS, IAM и proxy boundary

- **Что отсутствует:** applied Terraform plan, cloud inventory, domain, certificate, security groups, private routes и immutable deployed image digests.
- **Почему кодом не доказать:** Terraform source показывает intention, но не effective cloud state.
- **Нужное evidence:** reviewed plan/apply, external port scan, DNS/TLS checks, IAM/SG inventory, доказательство что Next доступен только через edge и private API/DB не публичны.

### EXT-004 — notification channels и incident response

- **Что отсутствует:** реальный destination, on-call owner, escalation и delivered alerts.
- **Почему кодом не доказать:** dashboard/log group не гарантирует, что человек получит сигнал.
- **Нужное evidence:** controlled uptime/5xx/latency/DB/storage/auth/payment/job alarm с delivery и acknowledgement.

### EXT-005 — primary production backup

- **Что отсутствует:** фактически созданный backup set и retention inventory.
- **Почему кодом не доказать:** Terraform retention setting не подтверждает успешное создание backup.
- **Нужное evidence:** provider backup ID/date/restore point/encryption/retention и application-consistent validation.

### EXT-006 — независимая encrypted backup copy у второго KZ provider

- **Что отсутствует:** выбранный второй провайдер в Казахстане, storage contract, encryption keys и replicated backup.
- **Почему кодом не доказать:** один provider/zone не является независимым disaster recovery.
- **Нужное evidence:** второй KZ location, object inventory/checksums, encryption/access policy и lifecycle.

### EXT-007 — restore drill

- **Что отсутствует:** реальное восстановление DB и media из primary и secondary copies.
- **Почему кодом не доказать:** runbook не является успешно проверенным восстановлением.
- **Нужное evidence:** isolated restore target, date, restore point, duration, checksums, migrations, application smoke, RPO/RTO и cleanup record.

### EXT-008 — legal/privacy approval и KZ residency

- **Что отсутствует:** утверждённый retention срок, consent/policy versions, data map, processor contracts, DSR owner/process и inventory фактических destinations.
- **Почему кодом не доказать:** юридическое основание и географию внешних providers нельзя вывести из TypeScript/Terraform намерений.
- **Нужное evidence:** подписанные policies, legal approval, production resource regions, log/backup/storage residency и DSR drill.

### EXT-009 — production ADMIN MFA enrollment

- **Что отсутствует:** реальная enrollment/recovery процедура и подтверждённое MFA для каждого production admin.
- **Почему кодом не доказать:** 2FA-ready architecture не доказывает состояние аккаунтов.
- **Нужное evidence:** production admin inventory, enforced enrollment, TOTP/recovery test, last-SUPER_ADMIN procedure и session policy verification.

### EXT-010 — текущий image vulnerability scan

- **Что отсутствует:** локальный/CI vulnerability report для exact финальных image digests.
- **Почему кодом не доказать:** dependency audit не покрывает OS packages/base image CVEs; Docker Scout был запрещён из-за внешней передачи metadata/layers, Trivy локально отсутствовал.
- **Нужное evidence:** blocking Trivy/эквивалент HIGH/CRITICAL scan в trusted CI для exact commit/images, reviewed exceptions и сохранённый artifact.

## Production Gate

| Gate           | Status       | Основание                                                                                                |
| -------------- | ------------ | -------------------------------------------------------------------------------------------------------- |
| FUNCTIONAL     | READY        | Полный доступный local unit/integration/built smoke/production build regression прошёл                   |
| SECURITY       | BLOCKER      | Source controls исправлены, но production MFA, effective edge/IAM и exact image CVE evidence отсутствуют |
| PRIVACY        | BLOCKER      | PII retention реализован технически; legal срок, residency и processor evidence отсутствуют              |
| PAYMENTS       | BLOCKER      | Internal state machine проходит; Halyk live merchant/callback contract отсутствует                       |
| DATABASE       | NOT VERIFIED | Миграции и role model проходят локально; фактические production grants/migration/PITR не проверены       |
| INFRASTRUCTURE | BLOCKER      | Terraform validate PASS, но real KZ deployment/domain/TLS/private networking не применены и не проверены |
| BACKUPS        | BLOCKER      | Нет primary backup evidence и независимой second-provider KZ copy                                        |
| RESTORE        | BLOCKER      | Нет реального primary/secondary restore drill                                                            |
| MONITORING     | BLOCKER      | Нет working notification destination и delivered alert evidence                                          |
| LOGGING        | NOT VERIFIED | Source redaction/structured logging проверены; production sink, retention и KZ residency не доказаны     |
| SEO            | READY        | Metadata/canonical/robots/sitemap/nonce JSON-LD и public preview smoke проходят                          |
| MOBILE         | READY        | 375/390/430 checks, key routes, drawer и overflow audit прошли                                           |
| ACCESSIBILITY  | NOT VERIFIED | Очевидные issues исправлены; полного screen-reader/assistive acceptance не было                          |
| PERFORMANCE    | NOT VERIFIED | Bounded queries/indexes/build проверены; production load/latency/query-plan evidence отсутствует         |

## Quality Gate

### Typecheck

PASS в обязательной Node.js 24.21 / pnpm 11.26 toolchain.

### Lint

PASS, 0 warnings; Prettier check PASS.

### Tests

PASS: unit Web 29/29, unit API 64/64, DB/integration/security 129/129, все built smoke и preview suites PASS.

### Production Build

PASS. Финальный build выполнен после последних mobile/CSS changes. API и Web production images собраны, non-root и имеют healthchecks.

### Secret and Image Content Checks

Tracked source, Git history и финальные image filesystems/history не содержат найденных secrets. Локальный игнорируемый `apps/api/.env` остаётся отдельным workstation-risk. Current image CVE scan не подтверждён.

## Known Issues

1. `apps/api/.env` содержит одно generic scanner совпадение, но файл игнорируется и не найден в Git/history/images.
2. Production external gates EXT-001…EXT-010 не закрыты.
3. Полный manual screen-reader audit не выполнен.
4. Production load test и query-plan evidence на реалистичном объёме отсутствуют.

Других известных воспроизводимых дефектов, оставленных заведомо сломанными в проверенном local workspace, нет.

## Technical Debt

- Production alert destinations и runbook ownership необходимо привязать к реальным ответственным лицам.
- Retention/DSR schedule требует юридического утверждения; техническая конфигурация намеренно не содержит придуманного срока.
- Halyk adapter остаётся fail closed до официального contract/credentials.
- Infrastructure source ещё не прошёл real plan/apply и cloud security validation.
- Accessibility и performance требуют отдельного acceptance на production-like environment.

Это не повод добавлять Redis, OpenSearch, Elasticsearch, Kafka, Kubernetes или другие компоненты без измеренной необходимости.

## Git State and Cleanup

- Существующие изменения пользователя не удалялись и не сбрасывались.
- `git reset --hard`, `git clean`, destructive database/cloud actions, Terraform apply/destroy, production migration, payment charge, DNS/TLS changes и secret rotation не выполнялись.
- Commit и push не выполнялись.
- Собственные inspect-контейнеры, tar-экспорты и временная audit DB удалены после проверки.
- Посторонние `qrg-arbitrage-*` контейнеры не изменялись.
- Local QRG database/storage containers не удалялись и их volumes не очищались.

## Final Decision

**PRODUCTION LAUNCH = NOT ALLOWED.**

Кодовая база существенно укреплена и локальные quality gates пройдены, но production запуск нельзя разрешить до получения фактических доказательств по всем обязательным external blockers и повторного финального gate review для exact commit/image digests.

## Следующая рекомендуемая работа

Выполнить отдельный external production-readiness closure: создать reviewable commit, прогнать trusted CI включая image vulnerability scan, затем последовательно закрыть EXT-001…EXT-010 реальными acceptance artifacts. Эта работа в рамках текущего recovery-аудита автоматически не выполнялась.
