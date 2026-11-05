# QRG MARKET — FINAL SECURITY & PRODUCTION READINESS REPORT

> Этот документ фиксирует исход Phase 10 на 25 сентября 2026 года. Актуальный статус после recovery/remediation от 2 октября 2026 года находится в [`recovery-audit-report.md`](./recovery-audit-report.md).

Дата проверки: 25 сентября 2026 года. Решение относится к проверенному локальному commit/worktree и не подтверждает состояние какого-либо production-аккаунта.

## 1. Executive Summary

**PRODUCTION LAUNCH = NOT ALLOWED.**

В коде не обнаружено открытых CRITICAL и технически исправимых HIGH после remediation. Найдены и исправлены три HIGH: корректная client identity за reverse proxy, ограничение append-only audit amplification и разделение runtime/migration DB secrets. Retest пройден.

Запуск блокируют внешние production-gates: отсутствует реальная доставка password reset, Halyk live acceptance и подтверждённый callback verification contract, фактическое KZ-развёртывание и TLS, работающие notification channels/alerts, независимая резервная копия у второго KZ-провайдера и реальный restore drill, а также подтверждение privacy/data-residency процесса. Эти пункты не симулировались.

## 2. Scope

Проверены authentication, authorization, multi-tenancy, Admin Area, CSRF/CORS/origin, XSS/SSRF, products, uploads, CustomerRequests, 2GIS, WhatsApp, PostgreSQL/Drizzle, Halyk/subscriptions, secrets, supply chain, Terraform, containers, object storage, logging/monitoring, backup/restore, privacy/residency, SEO, mobile, accessibility и performance. Новые product features не добавлялись.

## 3. Environment tested

- Windows local workspace, branch `phase-9-infrastructure`;
- Node.js 24.20.0, pnpm 11.26.0;
- local PostgreSQL 17 + PostGIS/pg_trgm в Docker, доступ только через `127.0.0.1`;
- local S3-compatible SeaweedFS, доступ только через `127.0.0.1`;
- Next.js production build/start и compiled NestJS API;
- Docker Desktop Linux images;
- Terraform 1.16.4 offline validation;
- browser checks на 375, 390, 430 px и desktop;
- Halyk: только safe offline contract/status fixtures; реальная банковская транзакция не выполнялась;
- Yandex Cloud production account/resources, реальный домен/TLS, SMTP/SMS, Halyk merchant и второй KZ backup provider недоступны.

## 4. Findings

| ID         | Severity | Кратко                                                                 | Status           |
| ---------- | -------- | ---------------------------------------------------------------------- | ---------------- |
| QRG-10-001 | HIGH     | Общая rate-limit identity за reverse proxy                             | FIXED            |
| QRG-10-002 | HIGH     | Неограниченный рост immutable admin audit при сканировании             | FIXED            |
| QRG-10-003 | HIGH     | Runtime и migration использовали один Lockbox secret                   | FIXED            |
| QRG-10-004 | HIGH     | Нет production password-reset delivery                                 | EXTERNAL BLOCKER |
| QRG-10-005 | HIGH     | Halyk live verification отсутствует                                    | EXTERNAL BLOCKER |
| QRG-10-006 | HIGH     | Production cloud/domain/TLS/IAM фактически не развёрнуты               | EXTERNAL BLOCKER |
| QRG-10-007 | HIGH     | Нет проверенного notification channel и alerts                         | EXTERNAL BLOCKER |
| QRG-10-008 | HIGH     | Нет secondary KZ backup и restore drill                                | EXTERNAL BLOCKER |
| QRG-10-009 | HIGH     | Privacy/data-residency не подтверждены на реальной инфраструктуре      | EXTERNAL BLOCKER |
| QRG-10-010 | MEDIUM   | CSP и HSTS отсутствуют в фактическом local HTTP response               | OPEN             |
| QRG-10-011 | MEDIUM   | Нет утверждённой retention/erasure automation для CustomerRequest PII  | OPEN             |
| QRG-10-012 | MEDIUM   | Anonymous analytics остаётся подвержена ограниченному metric poisoning | OPEN             |
| QRG-10-013 | LOW      | Несколько mobile targets меньше внутреннего 44 px ориентира            | OPEN             |
| QRG-10-014 | LOW      | Игнорируемый local `.env` дал generic secret finding                   | OPEN             |

## 5. CRITICAL

Подтверждённых CRITICAL findings нет.

## 6. HIGH

### QRG-10-001

- **Severity:** HIGH
- **Scenario:** Browser → ALB → Next BFF → private Nest API. API использовал `socket.remoteAddress`, поэтому публичные клиенты разделяли адрес proxy и могли взаимно исчерпать auth/request/admin/analytics buckets.
- **Affected Component:** API rate-limit guards и Next BFF.
- **Evidence:** до remediation guards использовали socket peer; архитектура направляет публичный трафик через Next. Официальная документация Yandex ALB указывает передачу client address через `X-Forwarded-For`.
- **Impact:** отказ легитимным пользователям и некорректная anti-abuse изоляция.
- **Root Cause:** недоверие к forwarded headers было корректным, но не было доверенной связи между boundary и API.
- **Fix:** Next создаёт HMAC-pseudonym исходного адреса и краткоживущий proof; private API проверяет proof, в production fail-closed. Raw IP не передаётся в Nest и не сохраняется.
- **Test proving fix:** unit proof tamper/missing tests; built Next catalog/request/seller/admin/subscription/analytics BFF tests; spoofed `X-Forwarded-For` tests.
- **Status:** FIXED.

### QRG-10-002

- **Severity:** HIGH
- **Scenario:** каждый анонимный запрос к Admin Area создавал неизменяемую audit row до какого-либо route-wide throttle.
- **Affected Component:** `AdminGuard`, `audit_logs`.
- **Evidence:** deny-path без ограничителя перед `AuditLog.append`.
- **Impact:** долговременный рост БД и availability degradation через безопасные по отдельности 401-запросы.
- **Root Cause:** audit completeness не была ограничена abuse budget.
- **Fix:** 60 denied admin accesses / 15 minutes per trusted client identity; запрос сверх лимита блокируется до append.
- **Test proving fix:** первые 60 запросов дают 401 и 60 audit rows; 61-й даёт 429, audit count не увеличивается.
- **Status:** FIXED.

### QRG-10-003

- **Severity:** HIGH
- **Scenario:** application и migration service accounts читали один application Lockbox secret, что позволяло runtime получить schema-owner credential.
- **Affected Component:** Terraform IAM/Lockbox, PostgreSQL deployment model.
- **Evidence:** `migration_runtime.secret_id` ранее ссылался на `yandex_lockbox_secret.application`.
- **Impact:** компрометация API могла дать DDL/owner privileges и ослабить immutable audit/payment ledger controls.
- **Root Cause:** service accounts были разделены, secrets и DB credentials — нет.
- **Fix:** отдельный KMS-backed migration secret, исключительная выдача migration SA; документированы `qrg_migration` и `qrg_runtime`, default privileges и запрет UPDATE/DELETE/TRUNCATE immutable ledgers.
- **Test proving fix:** Terraform validate; source test проверяет отдельный secret и required revokes.
- **Status:** FIXED в коде/IaC; фактическое применение входит в production deployment gate.

### QRG-10-004

- **Severity:** HIGH
- **Scenario:** пользователь не может получить reset token по реальному email/SMS.
- **Affected Component:** password reset delivery.
- **Evidence:** `UnconfiguredPasswordResetDelivery.available()` возвращает false; endpoint безопасно отвечает 503 для существующего и отсутствующего аккаунта.
- **Impact:** production account recovery отсутствует.
- **Root Cause:** не выбран delivery provider, нет credentials/domain/template/delivery evidence.
- **Fix:** подключить KZ-approved email/SMS adapter, secrets через Lockbox, generic response, one-time token и redacted delivery logs; проверить реальное получение.
- **Test proving fix:** end-to-end delivery на acceptance account, expiry/replay/enumeration/log scan.
- **Status:** EXTERNAL BLOCKER.

### QRG-10-005

- **Severity:** HIGH
- **Scenario:** попытка считать hosted return/callback источником payment truth без подтверждённого банковского verification contract.
- **Affected Component:** Halyk ePay subscription provider.
- **Evidence:** provider намеренно `available() === false`; нет real merchant credentials/acceptance/callback signature contract. Доступная [официальная документация Halyk ePay](https://epayment.kz/en-US/docs) не дала достаточного криптографического callback contract; `secret_hash` рассматривается только как echoed merchant value.
- **Impact:** live subscription payments нельзя безопасно активировать.
- **Root Cause:** внешние merchant settings и bank-confirmed contract не предоставлены.
- **Fix:** получить contract/credentials/acceptance, реализовать строго по документации и провести end-to-end initial/recurring/failure/replay tests.
- **Test proving fix:** банковский acceptance evidence с server-side status verification и idempotent ledger reconciliation.
- **Status:** EXTERNAL BLOCKER.

### QRG-10-006

- **Severity:** HIGH
- **Scenario:** repository Terraform принимается за доказательство существующей production perimeter.
- **Affected Component:** Yandex Cloud, DNS, Certificate Manager, ALB, compute, IAM, private API.
- **Evidence:** cloud resources не создавались; нет account credentials, domain, certificate или reviewed plan/apply evidence.
- **Impact:** нельзя подтвердить TLS, отсутствие публичной DB/API/SSH/debug exposure и effective IAM.
- **Root Cause:** внешние production identifiers и approvals отсутствуют.
- **Fix:** reviewed plan/apply, immutable image digests, private API/DB, HTTPS-only ALB, DNS/certificate, effective IAM/SG verification.
- **Test proving fix:** non-destructive cloud inventory, SG/route/port/TLS checks и external exposure scan.
- **Status:** EXTERNAL BLOCKER.

### QRG-10-007

- **Severity:** HIGH
- **Scenario:** dashboards/log group существуют только как source design без alert delivery.
- **Affected Component:** monitoring/incident response.
- **Evidence:** notification channel и alert resources отсутствуют.
- **Impact:** outage, auth anomaly, payment/storage/DB failure могут остаться незамеченными.
- **Root Cause:** нет approved notification destination/on-call process.
- **Fix:** uptime/5xx/latency/resource/DB/payment/webhook/auth/storage alerts с owner/runbook/escalation.
- **Test proving fix:** controlled test signal с фактической доставкой и acknowledgement.
- **Status:** EXTERNAL BLOCKER.

### QRG-10-008

- **Severity:** HIGH
- **Scenario:** Terraform retention принимается за доказанный backup/DR.
- **Affected Component:** PostgreSQL, media, second-provider KZ backup, restore.
- **Evidence:** primary backup только описан; secondary KZ copy и restore evidence отсутствуют. Yandex сейчас имеет один KZ zone `kz1-a`, поэтому два host в зоне не дают regional DR: [region documentation](https://yandex.cloud/en/docs/overview/concepts/region). Restore должен подтверждаться практическим тестом, а не retention setting: [Managed PostgreSQL backup documentation](https://yandex.cloud/en/docs/managed-postgresql/operations/cluster-backups).
- **Impact:** потеря данных или непредсказуемый RTO/RPO при zone/provider incident.
- **Root Cause:** не выбран второй KZ provider и не создан production backup set.
- **Fix:** encrypted/versioned independent KZ copy и два isolated restore drills с checksums/application validation.
- **Test proving fix:** evidence с date, restore point, isolated target, duration, validation и cleanup.
- **Status:** EXTERNAL BLOCKER.

### QRG-10-009

- **Severity:** HIGH
- **Scenario:** заявить соответствие KZ residency/privacy до проверки фактических destinations и contractual processing.
- **Affected Component:** DB, object storage, logs, analytics, backups, providers.
- **Evidence:** production resources/providers/policies не представлены; retention и DSR ownership не утверждены.
- **Impact:** риск незаконной обработки/трансграничного хранения PII.
- **Root Cause:** legal/operator decisions и deployed evidence отсутствуют.
- **Fix:** data map, KZ storage evidence, processor contracts, retention schedule, DSR procedure, access review.
- **Test proving fix:** inventory фактических destinations и approved privacy records.
- **Status:** EXTERNAL BLOCKER.

## 7. MEDIUM

### QRG-10-010

- **Severity:** MEDIUM
- **Scenario:** XSS/clickjacking hardening зависит только от escaping и `X-Frame-Options`; downgrade protection зависит от внешнего TLS edge.
- **Affected Component:** Next response headers / future ALB.
- **Evidence:** runtime response содержит nosniff, DENY, Referrer-Policy, Permissions-Policy, но не CSP/HSTS.
- **Impact:** меньше defense-in-depth при будущей injection или ошибочной HTTP exposure.
- **Root Cause:** nonce-based CSP и real HTTPS edge ещё не настроены.
- **Fix:** nonce/hash CSP с `frame-ancestors 'none'`, `object-src 'none'`, `base-uri 'self'`; HSTS только после проверенного HTTPS domain.
- **Test proving fix:** header test + CSP report-only rollout без нарушений.
- **Status:** OPEN.

### QRG-10-011

- **Severity:** MEDIUM
- **Scenario:** CustomerRequest PII хранится без утверждённого автоматического срока удаления/анонимизации.
- **Affected Component:** privacy operations/customer_requests/backups.
- **Evidence:** consent version/timestamp и data minimization есть; approved retention/erasure job отсутствует.
- **Impact:** избыточное хранение телефонов и комментариев.
- **Root Cause:** не принято legal/business retention решение.
- **Fix:** утвердить сроки, legal hold и DSR; реализовать bounded purge/anonymization с audit и backup lifecycle.
- **Test proving fix:** expiry fixtures, idempotent purge, tenant/admin access и backup deletion verification.
- **Status:** OPEN.

### QRG-10-012

- **Severity:** MEDIUM
- **Scenario:** бот может генерировать допустимые anonymous view/click events в пределах 300/15 min/client и искажать seller metrics.
- **Affected Component:** public analytics ingestion.
- **Evidence:** event schema/resource validation и rate limit есть, visitor identity/PII отсутствуют; strong authenticity отсутствует по design.
- **Impact:** ограниченное искажение бизнес-аналитики, не authorization/payment compromise.
- **Root Cause:** cookieless privacy-first anonymous analytics.
- **Fix:** edge bot/WAF controls, anomaly thresholds и server-derived high-value events; не добавлять persistent IP identity.
- **Test proving fix:** synthetic anomaly test и alert delivery.
- **Status:** OPEN.

## 8. LOW

### QRG-10-013

- **Severity:** LOW
- **Scenario:** на 375 px некоторые интерактивные цели имеют высоту 21–42 px вместо внутреннего ориентира 44 px.
- **Affected Component:** top CTA, compact search/category navigation.
- **Evidence:** browser bounding-box check: top CTA 21 px, search action 34–36 px, category links 42 px.
- **Impact:** сниженное удобство для пользователей с моторными ограничениями.
- **Root Cause:** плотная reference-aligned композиция.
- **Fix:** увеличить invisible hit area/min-block-size без визуального раздувания layout.
- **Test proving fix:** 375/390/430 bounding-box assertion и manual touch test.
- **Status:** OPEN.

### QRG-10-014

- **Severity:** LOW
- **Scenario:** локальный `apps/api/.env` содержит значение, распознанное generic scanner как potential secret.
- **Affected Component:** developer workstation hygiene.
- **Evidence:** file игнорируется Git и не присутствует в history/tracked source; содержимое не выводилось в отчёт.
- **Impact:** локальная компрометация workstation может раскрыть dev credential; repository leak не подтверждён.
- **Root Cause:** обычный local env workflow.
- **Fix:** хранить только local credentials, ротировать при сомнении, production values брать из Lockbox.
- **Test proving fix:** Git/history scan остаётся чистым; проверка provider-side credential inventory.
- **Status:** OPEN.

## 9. Authentication

Opaque 32-byte server sessions, SHA-256 DB hashes, Argon2id, fixation resistance, rotation, logout, revoke-one/all, expiry, disabled account checks, generic enumeration-safe errors и bounded brute-force tests пройдены. Reset token hash/expiry/one-time/replay logic пройдены. Production delivery — QRG-10-004 BLOCKER.

## 10. Authorization

Permission вычисляется сервером из authenticated user → `shop_members` → role/permission → locked resource. Payload role/shop/owner/permission mass assignment отклоняется. Vertical escalation seller/employee/manager/admin/SUPER_ADMIN tests пройдены.

## 11. Multi-Tenancy

IDOR/BOLA tests покрывают Shop, Product, Variant, CustomerRequest, Member, Analytics, Subscription, Images и Settings. Membership revocation и stale principal revalidation проверены. Cross-tenant доступ не воспроизведён.

## 12. Admin

Admin cookie/session отделены от seller; production 2FA architecture mandatory; TOTP replay/recovery hashes/last-super-admin/session idle+absolute lifetime/CSRF/audit immutability пройдены. Critical UI actions используют explicit reason и confirmation. Фактическое enrollment production-admin не проверено до deployment.

## 13. Products

Tenant ownership, invalid/negative/extreme price validation, variants, draft/publish rules, bulk atomicity, duplicate/autosave races и optimistic concurrency пройдены. Publication требует image и не обходит moderation/subscription visibility.

## 14. Uploads

JPEG/PNG/WebP magic+MIME+real Sharp decode, 10 MB/10 image limits, dimension/pixel/page limits, timeout, EXIF stripping, WebP output, UUID keys, S3 private access, orphan cleanup, ambiguous PUT и membership-revocation race tests пройдены. SVG/HTML/executable/spoof/corrupt files отклоняются.

## 15. CustomerRequests

Guest flow не требует account. Consent, phone normalization, input bounds, honeypot, HMAC challenge, deduplication, payload limit, transactional analytics и tenant isolation пройдены. Phone не копируется в analytics/logs. Production feature flag по умолчанию выключен; CAPTCHA abstraction fail-closed при обязательном режиме.

## 16. 2GIS

Принимается только canonical HTTPS firm URL согласованного 2GIS domain/format, optional firm ID сверяется. `javascript:`, `data:`, `file:`, lookalike, CRLF, encoded/parser confusion и arbitrary domains отклоняются.

## 17. WhatsApp

Только E.164 и `wa.me`; product/variant передаются через URL encoding. Scheme/redirect/control/newline injection tests пройдены.

## 18. SSRF

2GIS URL не fetch-ится backend. Upload принимает bytes, не remote URL. Halyk endpoints фиксированы allowlisted HTTPS config с redirect rejection. Пользовательские localhost/link-local/RFC1918 URLs не достигают network sink. Подтверждённого SSRF нет.

## 19. XSS

React escaping используется для public/seller/admin text. JSON-LD заменяет `<`; query/search/moderation/customer content не вставляется через unsafe HTML. Stored/reflected payload tests и SSR escaping пройдены. CSP debt — QRG-10-010.

## 20. CSRF

State-changing seller/admin endpoints требуют exact Origin, `Sec-Fetch-Site` protection, JSON/multipart type, `x-qrg-client` и session-bound CSRF token. Cross-session/seller-vs-admin/missing/wrong origin cases отклоняются.

## 21. SQL/Database

Drizzle parameterization и bounded enum-based sorting используются; FTS/search/admin/pagination injection tests пройдены. FK/UNIQUE/CHECK/orphan/financial uniqueness/transaction/concurrency tests пройдены. GIN/GiST и analytics index используются; analytics fixture plan дал Index Only Scan около 0.04 ms. Schema/migrations в PHASE 10 не менялись. Runtime/migration privilege design исправлен, но production grants ещё не применены.

## 22. Halyk

Frontend redirect и Admin UI не являются payment truth. Fixed tariff 10 000 KZT задаётся backend; amount/currency/merchant/invoice/subscription/provider ID/replay/concurrency/status fixtures пройдены. Provider fail-closed. Live gate — QRG-10-005 BLOCKER.

## 23. Subscriptions

ACTIVE/PAST_DUE/GRACE/SUSPENDED/CANCELLED, renewal/retry/5-day grace/reactivation/cancel/date boundaries/duplicate/concurrent updates пройдены. Suspension скрывает public storefront без удаления seller data/dashboard.

## 24. Secrets

Gitleaks: 3 commits, ~2.54 MB, 0 history leaks. `apps/api/src`, `apps/web/app/lib/components`, `infra`, `docs`, `.github`, `scripts`: 0 findings. Safe examples содержат пустые placeholders. Один ignored local `.env` finding отмечен как QRG-10-014; secret value не раскрывался.

## 25. Infrastructure

Terraform source фиксирует KZ zone, private subnets/SG, private PostgreSQL, KMS, Lockbox, private bucket и registries; `terraform fmt`/`validate` пройдены. Compute/ALB/DNS/certificate/real IAM/apply отсутствуют: QRG-10-006.

## 26. Containers

Оба финальных image используют distroless/non-root UID 65532, pinned base digests, frozen install, read-only/cap-drop/no-new-privileges runtime policy и healthchecks. API: 78 MB, digest `sha256:488ce8c35a9b...`; Web: 85 MB, digest `sha256:abe5bec343bc...`. Docker Scout: 0 CRITICAL, 0 HIGH, 0 MEDIUM, 0 LOW в обоих образах. Local compose runtime healthy.

## 27. Object Storage

Local S3 round-trip/cross-tenant/private visibility/orphan tests пройдены. Terraform включает private ACL posture, KMS encryption и versioning. Actual production bucket ACL/CORS/key rotation/deletion не проверены из-за отсутствия deployment.

## 28. Logging

Application events структурированы и исключают bodies/tokens/passwords/card data/full phone. Error responses не раскрывают stack/SQL/path/env. Реальный production log destination/access/retention не проверен.

## 29. Monitoring

Runbook существует, но notification channel и alert rules отсутствуют. Status: BLOCKER, QRG-10-007.

## 30. Backups

Source задаёт 14-day managed retention и weekly 30-day recovery points, но существование/timestamps/encryption/access фактических backups не проверены. Secondary KZ copy отсутствует. Status: BLOCKER.

## 31. Restore

Runbook содержит isolated restore procedure и required evidence, но реальный restore никогда не выполнялся. Status: BLOCKER.

## 32. Privacy

Data minimization, separate privacy consent, no marketing default, analytics without raw IP/visitor ID/phone соблюдены. CustomerRequest retention/erasure и production operator/legal approval не завершены.

## 33. Data Residency

Terraform предназначен для Yandex Cloud Kazakhstan, но фактические DB/object/log/backup destinations и second-provider location не проверены. Status: BLOCKER.

## 34. SEO

Metadata/canonical/robots/sitemap/OpenGraph/structured data и 404 tests пройдены; admin/auth/seller pages имеют `noindex, nofollow`. Indexing требует explicit production launch, trusted HTTPS origin и live API. Fixture data не попадает в sitemap.

## 35. Mobile

Browser проверка 375/390/430 px: horizontal document overflow отсутствует; mobile header/menu/search/catalog/filter drawer/login flows отображаются. 375 px filter drawer открывается как native modal, focus переводится на close control; labels присутствуют. Небольшой touch-target debt — QRG-10-013.

## 36. Accessibility

Есть skip-link, semantic headings, labels, alt, keyboard-capable native controls/dialog, focus return, error regions и no unlabeled form controls в проверенных home/seller/admin screens. Полный screen-reader/real-device/contrast audit не выполнен; gate не переводится в READY только по автоматической проверке.

## 37. Performance

Bounded pagination/payloads, database indexes, query plan, optimized uploaded images, Server Components и no third-party analytics подтверждены. Production load, CDN/cache behavior и Core Web Vitals на реальной сети не измерены; Redis/OpenSearch не добавлялись.

## 38. Fixes applied

- добавлен signed pseudonymous client proof между Next BFF и private API;
- исправлены auth/request/admin/analytics rate-limit identities;
- ограничена запись denied admin audit до 60/15 min/client;
- anonymous analytics limit снижен с 5000 до 300/15 min/client;
- добавлены production config/env/CI/smoke wiring и security tests;
- разделены application/migration Lockbox secrets;
- добавлен least-privilege PostgreSQL role runbook.

Основные изменённые файлы:

- `apps/api/src/auth/client-identity.ts`, `auth/guards.ts`, `admin/guards.ts`, `requests/spam.ts`, `analytics/controller.ts`, `config.ts`;
- `apps/web/lib/internal-client.ts` и четыре BFF routes;
- auth/admin/request/operations/Web tests;
- `.github/workflows/ci.yml`, production env examples, `compose.yaml`, smoke scripts;
- `infra/terraform/environments/production/security.tf`, `outputs.tf`, `README.md`;
- `docs/operations/database-roles.md`, `docs/operations/deployment.md`.

Database: migrations и application schema не изменялись.

## 39. Retest results

- QRG-10-001: PASS — valid proof accepted, missing/tampered proof fails closed in production; built BFF flows pass.
- QRG-10-002: PASS — 61-й anonymous admin request получает 429 до audit append.
- QRG-10-003: PASS — Terraform validates; source test confirms isolated migration secret and immutable-ledger revokes.
- Regression: all unit/integration/security/BFF suites pass after fixes.

## 40. Tests

- Unit: Web 27/27; API 63/63.
- Integration/security including built BFF: 132/132 (DB/auth/catalog 44; requests 11; admin 15; operations 7; admin-control 15; subscriptions 13; payments 8; media 11; analytics 8).
- Production smoke: 2/2.
- Web preview/SEO/accessibility SSR: 10/10.
- Catalog/request/seller/admin/subscription smoke suites: PASS.
- Terraform fmt/validate: PASS.
- Dependency audit: 0 known production vulnerabilities.
- Gitleaks tracked/history/source scopes: 0 repository leaks.
- Docker Scout: 0 findings for API and Web.

Промежуточные ошибки не скрыты: первый DB run не получил `DATABASE_URL` из отсутствующего `.env.test`; первый media run не получил local S3 env; первый production smoke унаследовал test HTTP S3 env; два новых rate-limit tests сначала использовали устаревший key/оставляли bucket. Environment был задан явно, tests исправлены и все наборы повторно прошли.

## 41. Typecheck

`pnpm typecheck`: PASS для API и Web.

## 42. Lint

`pnpm lint`: PASS, 0 warnings. `pnpm format:check`: PASS. `pnpm source:check`: PASS для 190 source files. `git diff --check`: PASS.

## 43. Production Build

`pnpm build`: PASS. Next.js 16.3.4 production routes собраны; NestJS compiled. Production API/Web Docker builds и local healthchecks PASS.

## 44. Remaining Technical Debt

- QRG-10-010: nonce/hash CSP и HTTPS-edge HSTS;
- QRG-10-011: approved PII retention/erasure automation;
- QRG-10-012: analytics anomaly/WAF controls;
- QRG-10-013: увеличить compact mobile hit areas;
- manual screen-reader, real-device и field Core Web Vitals/load test;
- production S3 credential rotation/federation и operational verification.

## 45. External Blockers

1. Рабочий production password-reset delivery provider и delivery evidence.
2. Halyk merchant credentials, bank-confirmed callback verification contract и acceptance E2E.
3. Yandex Cloud production account/folder, domain, TLS, ALB/compute и effective IAM/SG verification.
4. Реальные notification channels и tested alerts.
5. Фактические primary backups, independent encrypted second-KZ-provider copy и restore drills.
6. Approved privacy/retention/DSR process и evidence всех production data destinations в Казахстане.
7. Production admin MFA enrollment и secret/key provisioning должны быть подтверждены при deployment.

## 46. Production Gate

| Gate           | Status       | Основание                                                              |
| -------------- | ------------ | ---------------------------------------------------------------------- |
| FUNCTIONAL     | BLOCKER      | Password-reset production delivery отсутствует                         |
| SECURITY       | NEEDS FIX    | Кодовые HIGH закрыты; CSP/HSTS и production perimeter ещё не завершены |
| PRIVACY        | BLOCKER      | Retention/DSR/residency evidence отсутствуют                           |
| PAYMENTS       | BLOCKER      | Halyk live verification отсутствует                                    |
| DATABASE       | NOT VERIFIED | Source/private design валиден; production grants/network не применены  |
| INFRASTRUCTURE | BLOCKER      | Cloud/domain/TLS/runtime не развёрнуты                                 |
| BACKUPS        | BLOCKER      | Actual primary/secondary KZ backup evidence отсутствует                |
| RESTORE        | BLOCKER      | Restore drill не выполнялся                                            |
| MONITORING     | BLOCKER      | Alerts не имеют notification channel                                   |
| LOGGING        | NOT VERIFIED | Source безопасен; production destination/access не проверены           |
| SEO            | READY        | Local production build и gating tests пройдены                         |
| MOBILE         | READY        | 375/390/430 и responsive flows пройдены; LOW debt отдельно             |
| ACCESSIBILITY  | NEEDS FIX    | Baseline пройден, полный assistive-tech audit не выполнен              |
| PERFORMANCE    | NOT VERIFIED | Query/build/image evidence есть, production CWV/load отсутствуют       |

**Итог: PRODUCTION LAUNCH = NOT ALLOWED.**

Следующая рекомендуемая фаза: отсутствует. PHASE 10 завершена; нужен отдельный production-unblocking цикл только после предоставления внешних credentials, contracts, providers и approvals.

---

# ПРИЛОЖЕНИЕ A. ПОЛНЫЙ ОТЧЁТ ПО ПРОЕКТУ QRG MARKET

Статус описания актуализирован 26 сентября 2026 года. Это приложение раскрывает весь реализованный проект, а не только результаты финального security-аудита. Оно не заменяет перечисленные выше production gates и не утверждает, что внешняя инфраструктура уже создана.

## A.1. Назначение продукта

QRG MARKET создаётся как локальная цифровая витрина реальных бутиков и магазинов Караганды. Платформа объединяет предложения разных продавцов в одном публичном каталоге и помогает покупателю перейти от поиска товара к прямому контакту с конкретным магазином.

Покупатель может без обязательной регистрации:

- открыть главную страницу и каталог;
- искать товары, категории, бренды и бутики;
- применять фильтры каталога;
- просматривать карточку товара, цену, старую цену, варианты и заявленное наличие;
- просматривать страницу бутика, адрес и контактные данные;
- открыть проверенную ссылку на официальную карточку магазина в 2GIS;
- открыть WhatsApp с заранее сформированным и корректно закодированным сообщением;
- отправить продавцу CustomerRequest;
- ознакомиться с уведомлением о том, что оплата производится напрямую продавцу.

Продавец получает отдельный кабинет для управления магазином, сотрудниками, товарами, изображениями, заявками, базовой аналитикой, модерацией магазина и подпиской.

Администратор получает отдельную защищённую Admin Area для проверки магазинов, модерации, управления платформенными ролями и просмотра неизменяемого журнала действий.

## A.2. Неприкосновенные бизнес-границы

QRG MARKET не является платёжным посредником по товарным сделкам. Система не принимает деньги покупателя за товар, не хранит buyer balance, seller balance или wallet, не выполняет payout, не использует escrow и не создаёт buyer payment transaction.

Путь покупки выглядит так:

```text
Покупатель
  → находит товар в QRG MARKET
  → связывается с продавцом
  → оплачивает товар продавцу напрямую
```

Внутренняя сущность обращения называется `CustomerRequest`. Статус `CONFIRMED` означает только подтверждение обращения продавцом. Он не означает, что товар оплачен.

QRG MARKET получает оплату только от продавцов за доступ к платформе. Зафиксированный тариф:

```text
QRG BUSINESS
10 000 KZT за один календарный месяц
```

Пробный период технически допускается моделью только как будущая возможность, но в текущей реализации выключен и автоматически не активируется.

## A.3. Пользовательские роли и границы доступа

### Покупатель

Покупатель не обязан создавать аккаунт для публичного каталога, контакта через 2GIS или WhatsApp и отправки заявки. Это снижает трение и одновременно ограничивает объём собираемых персональных данных.

### Владелец магазина

`SHOP_OWNER` имеет полный доступ в пределах своего магазина:

- магазин и контакты;
- товары, варианты и изображения;
- сотрудники;
- заявки покупателей;
- аналитика;
- подписка;
- отправка магазина на проверку.

### Менеджер магазина

`SHOP_MANAGER` имеет операционный доступ к товарам, контенту, заявкам и аналитике, но не получает полномочия владельца на критические настройки и управление владением.

### Сотрудник магазина

`SHOP_EMPLOYEE` имеет ограниченный доступ к товарным операциям, availability и заявкам. Он не может повысить собственную роль или выполнить owner-only действие.

### Администраторы платформы

Admin Area отделена от seller-интерфейса и использует отдельную сессию. Реализованы ограниченные платформенные роли, включая `SUPER_ADMIN`, `MODERATION_ADMIN`, `SUPPORT_ADMIN`, `FINANCE_ADMIN` и legacy-compatible `ADMIN`. Сервер вычисляет разрешения из admin account, а не из данных браузера.

Ограниченные администраторы не получают автоматически права `SUPER_ADMIN`. Последний активный супер-администратор не может быть отключён или понижен таким образом, чтобы платформа осталась без управляющего администратора.

## A.4. Жизненный цикл магазина

Поддерживаются статусы:

```text
DRAFT
PENDING_VERIFICATION
CHANGES_REQUESTED
VERIFIED
ACTIVE
SUSPENDED
REJECTED
```

Новый магазин не становится публичным автоматически. Нормальный путь:

```text
Seller создаёт магазин
  → DRAFT
  → отправляет на проверку
  → PENDING_VERIFICATION
  → Admin принимает решение
  → VERIFIED
  → при выполнении subscription visibility rules
  → ACTIVE
```

`REQUEST_CHANGES` и `REJECT` требуют причины. Причина доступна правильному продавцу и не раскрывается другому tenant. `SUSPENDED` скрывает магазин и товары из публичной части, но не удаляет данные и не лишает продавца доступа к кабинету.

## A.5. Жизненный цикл обращения покупателя

Поддерживаются статусы:

```text
NEW
VIEWED
CONTACTED
CONFIRMED
CLOSED
REJECTED
```

В заявке сохраняются минимально необходимые данные:

- имя;
- нормализованный телефон;
- товар;
- вариант при наличии;
- количество;
- предпочтение получения при наличии;
- комментарий при наличии;
- тип, версия и время privacy consent;
- статус и timestamps.

Email, дата рождения, индивидуальный идентификационный номер и платёжные данные покупателя не собираются.

## A.6. Жизненный цикл подписки продавца

Поддерживаются статусы:

```text
ACTIVE
PAST_DUE
GRACE
SUSPENDED
CANCELLED
```

Основной сценарий неуспешного продления:

```text
ACTIVE
  → recurring payment failed
  → PAST_DUE
  → retry
  → GRACE
  → пять дней
  → SUSPENDED
```

При `SUSPENDED` не удаляются магазин, товары, варианты или изображения. Публичная витрина скрывается, кабинет остаётся доступным. После подтверждённого успешного продления допустим переход из `PAST_DUE`, `GRACE` или subscription-level `SUSPENDED` в `ACTIVE`. Административная блокировка магазина платёжным событием не снимается.

# ПРИЛОЖЕНИЕ B. ВЫПОЛНЕНИЕ ФАЗ РАЗРАБОТКИ

## B.1. PHASE 0 — технический фундамент

Подготовлен pnpm monorepo без искусственных packages. Рабочие приложения находятся в `apps/web` и `apps/api`.

Реализованы:

- единый root package lifecycle;
- строгая TypeScript-конфигурация;
- Next.js App Router;
- NestJS application bootstrap;
- versioned REST API `/api/v1`;
- глобальная DTO validation с запретом неизвестных полей;
- унифицированные безопасные API errors;
- health и readiness endpoints;
- OpenAPI/Swagger только в разрешённой конфигурации;
- Docker Compose для PostgreSQL и local object storage;
- development, test и production configuration validation;
- безопасные `.env.example` и production examples без реальных секретов;
- ESLint, Prettier, typecheck, tests и production build scripts.

## B.2. PHASE 1 — database foundation, authentication и multi-tenancy

Созданы основные authentication и tenant entities: users, sessions, shops и shop members.

Реализованы:

- signup;
- login;
- logout;
- получение текущей сессии;
- список пользовательских сессий;
- отзыв одной сессии;
- отзыв всех сессий;
- конкурентно безопасная rotation;
- password-reset token generation и consumption architecture;
- Argon2id password hashing;
- opaque session tokens;
- хранение только hash токена;
- CSRF token, связанный с сессией;
- role and permission matrix;
- server-side tenant revalidation;
- защита от session fixation, replay, account enumeration и mass assignment.

## B.3. PHASE 2 — публичная витрина и design system

Созданы публичные маршруты и визуальная система premium marketplace. Реализованы Header, Footer, кнопки, поля ввода, select, badges, карточки категорий, магазинов и товаров, loading/empty/error states, mobile drawer и filters.

Development fixtures отделены от production API. В production и test режимах fixtures не могут стать source of truth.

## B.4. PHASE 3 — реальные товары, каталог, поиск и 2GIS

Добавлены categories, brands, products, product variants, product images, shop locations и shop contacts.

Реализованы:

- публичный каталог;
- category/subcategory/brand/shop/mall filters;
- price, size, color, availability и discount filters;
- URL-synchronized query parameters;
- stable bounded pagination;
- sorting;
- detail endpoints;
- PostgreSQL Full Text Search;
- `pg_trgm` typo matching;
- autocomplete;
- GIN и trigram indexes;
- PostGIS extension для будущего nearby search;
- strict 2GIS link validation без Places API.

## B.5. PHASE 4 — seller dashboard и управление товарами

Создан кабинет продавца с разделами обзора, товаров, заявок, статистики, подписки, магазина, сотрудников и настроек.

Реализованы создание, чтение, изменение, варианты, availability, draft/archive flows, image order, branding images и tenant-scoped operations.

Image pipeline выполняет MIME и magic-byte validation, реальное декодирование, ограничение размеров и количества пикселей, удаление EXIF, resize и сохранение производного WebP. Binary data не хранится в PostgreSQL.

## B.6. PHASE 5 — CustomerRequest и WhatsApp

Создан публичный flow заявки без аккаунта покупателя. Реализованы server-side validation, payload limit, phone normalization, consent validation, honeypot, HMAC challenge, rate limits, duplicate suppression и CAPTCHA-ready policy.

WhatsApp message формируется только для нормализованного E.164 номера и кодируется через безопасные URL parameters.

## B.7. PHASE 6 — Admin Area и модерация

Созданы отдельные admin routes, admin session, TOTP enrollment, recovery codes, permission matrix, moderation queue, shop detail, decisions, moderation history и audit log.

Audit trail защищён database triggers от update, delete и truncate. Critical actions требуют reason и создают request-correlated audit events.

## B.8. PHASE 7 — внутренняя subscription business logic

Созданы subscriptions, payment attempts и subscription payments. State machine реализована независимо от банка. Сумма и валюта проверяются на сервере. Duplicate event, date boundary и concurrent state update покрыты тестами.

## B.9. PHASE 7B — Halyk provider architecture

Создан абстрактный `PaymentProvider` и `HalykPaymentProvider`. Subscription service не зависит напрямую от конкретного банка. Реализованы безопасные contracts для initial и recurring flows, invoice binding, immutable attempt/receipt association, amount/currency/merchant/subscription checks и replay protection.

Реальный Halyk write flow намеренно заблокирован до получения официально подтверждённого callback verification contract и merchant acceptance. Fake success не используется даже в production-compatible code path.

## B.10. PHASE 7C — визуальное выравнивание public UI

Публичный интерфейс приведён к переданному reference: тёмная informational top bar, коммерческий header, центральный поиск, category navigation, fashion hero, category strip, boutique cards, compact product cards и тёмный seller call-to-action.

Фальшивые рейтинги, отзывы, продажи и количества пользователей не добавлены.

## B.11. PHASE 8 — analytics, search experience, SEO и quality

Реализованы shop views, product views, WhatsApp clicks, 2GIS clicks и CustomerRequest events. Seller analytics поддерживает периоды 7, 30 и 90 дней и показывает popular products.

Analytics events не содержат raw IP, phone, email, URL query, visitor identifier или произвольный metadata payload.

Добавлены metadata, canonical, robots, sitemap, OpenGraph, structured data и private-route noindex.

## B.12. PHASE 8B — seller operations и admin control center

Добавлены persisted product drafts, optimistic autosave, one-time materialization, duplicate product, bounded bulk actions, onboarding progress, seller list search/status/count pagination и расширенный admin control center.

Admin control center включает overview, users, products, subscriptions и administrator management с отдельными permissions и audit requirements.

## B.13. PHASE 9 — production infrastructure design

Подготовлены hardened multi-stage Docker images, Terraform production core для Yandex Cloud Kazakhstan, private networking, Managed PostgreSQL, KMS, Lockbox, private versioned object storage, registry retention/scanning и Cloud Logging group.

Добавлены deployment, rollback, monitoring, backup/restore, production architecture и database roles runbooks. Эти материалы являются deployable source design, но не доказательством фактически созданной инфраструктуры.

## B.14. PHASE 10 — независимый red-team review

Проведены первичный audit pass, remediation только подтверждённых технически исправимых HIGH и повторный retest. Три HIGH исправлены. Внешние blockers не заменены mocks или фиктивными доказательствами.

# ПРИЛОЖЕНИЕ C. ТЕХНИЧЕСКАЯ АРХИТЕКТУРА

## C.1. Архитектурный стиль

Применён modular monolith. Бизнес-модули изолированы внутри одного NestJS deployment unit и одной PostgreSQL database. Это соответствует масштабу MVP и уменьшает операционную сложность.

Microservices, Kubernetes, Kafka, RabbitMQ, Redis, Elasticsearch и OpenSearch отсутствуют, потому что измеренной необходимости в них нет.

## C.2. Runtime flow

```text
Публичный интернет
  → HTTPS Application Load Balancer в будущем production deployment
  → Next.js public/server boundary
  → private NestJS REST API
  → private PostgreSQL
  → private S3-compatible Object Storage
```

Frontend не получает database credentials и не подключается к PostgreSQL. Browser-facing state-changing requests проходят через ограниченные Next Backend-for-Frontend routes.

## C.3. Monorepo

```text
apps/
  api/
    drizzle/
    src/
    test/
  web/
    app/
    components/
    lib/
    public/
    test/

docs/
  operations/

infra/
  postgres/
  terraform/

scripts/
```

Отдельные `packages/ui`, `packages/shared`, `packages/types` и `packages/config` не создавались, потому что фактической необходимости в независимых publishable packages пока нет.

## C.4. Runtime и dependency versions

Зафиксированы:

- Node.js 24.20.x compatibility range;
- pnpm 11.26.0;
- Next.js 16.3.4;
- React 19.2.8;
- NestJS 12.0.1;
- Drizzle ORM 0.45.2;
- PostgreSQL client 8.23.0;
- Sharp 0.35.4;
- Argon2 0.45.1;
- TypeScript 6.0.3.

Lockfile обязателен, install выполняется с `--frozen-lockfile`, версии production dependencies закреплены, разрешённые lifecycle builds перечислены явно.

# ПРИЛОЖЕНИЕ D. FRONTEND И ПОЛЬЗОВАТЕЛЬСКИЕ МАРШРУТЫ

## D.1. Публичные страницы

- `/` — главная витрина;
- `/catalog` — каталог, поиск, сортировка и фильтры;
- `/product/[slug]` — карточка товара;
- `/shop/[slug]` — публичная страница бутика;
- `/privacy/requests` — информация о privacy consent для заявок;
- `/robots.txt` — индексирование;
- `/sitemap.xml` и segmented public sitemap — SEO discovery.

## D.2. Seller pages

- `/seller/login` — seller authentication;
- `/seller/[[...segments]]` — server-rendered seller workspace с tenant-scoped data.

Private seller pages получают `noindex, nofollow` и не появляются в sitemap.

## D.3. Admin pages

- `/admin/login` — отдельная admin authentication surface;
- `/admin/[[...segments]]` — Admin Area и control center.

Seller cookie не пересылается в admin boundary, admin cookie не пересылается в seller boundary.

## D.4. Backend-for-Frontend routes

- `/api/seller/[...path]` — allowlisted seller proxy;
- `/api/admin/[...path]` — allowlisted admin proxy;
- `/api/requests` — public CustomerRequest boundary;
- `/api/analytics` — public analytics boundary;
- `/api/search` — bounded search/autocomplete boundary;
- `/api/images/[imageId]` — controlled image delivery.

Каждый proxy ограничивает methods, paths, query parameters, content type, payload size, redirect behavior, timeout и forwarded credentials.

## D.5. UI design status

Public design соответствует reference по композиции и плотности:

- dark top bar;
- white main header;
- QRG MARKET branding;
- central search;
- compact category navigation;
- large fashion hero;
- category strip;
- boutique section;
- product section;
- dark seller subscription call-to-action;
- responsive mobile composition.

Если production API не возвращает активные магазины или товары, интерфейс показывает честный empty state, а не создаёт фальшивые коммерческие данные.

# ПРИЛОЖЕНИЕ E. BACKEND API

## E.1. Authentication API

Под `/api/v1/auth` реализованы signup, login, current session, session list, logout, revoke all sessions, revoke one session, rotate session, password-reset request и password-reset confirmation.

## E.2. Shop and membership API

Под `/api/v1/shops` реализованы list, create, detail, rename, member list/detail, add member, change role и remove member.

Frontend-supplied `shopId`, `ownerId`, role или permissions не являются источником разрешения. Shop ID из URL используется только как resource selector и обязательно сопоставляется с текущим membership в database transaction.

## E.3. Seller product API

Реализованы create/list/detail/update products, create/update variants, location, contacts, profile, drafts, draft materialization, duplication, bulk actions и image ordering.

## E.4. Public catalogue API

Под `/api/v1/public` реализованы catalog, categories, brands, filters, product detail, shop list/detail, shop products, search suggestions и paginated SEO entries.

## E.5. CustomerRequest API

Публичные endpoints выдают подписанный challenge и принимают bounded request. Seller endpoints предоставляют list/detail/status update только для разрешённого магазина.

## E.6. Media API

Реализованы product image upload/delete/content, shop cover/logo upload/content и public image delivery. До разбора multipart выполняется authorization, что ограничивает resource consumption неавторизованным клиентом.

## E.7. Analytics API

Публичный endpoint принимает только известные события для существующих публичных ресурсов. Seller summary endpoint требует membership и допустимую роль.

## E.8. Subscription API

Owner-only endpoints предоставляют read, create, renew, cancel и disable auto-renew. Browser не может передать сумму тарифа или назначить subscription status.

## E.9. Admin API

Реализованы admin login, temporary-password change, TOTP setup/verify, current session, logout, rotation, dashboard, shop queue/detail/decision, audit list, seller verification submission, platform overview, user/product/subscription lists и administrator management.

# ПРИЛОЖЕНИЕ F. DATABASE INVENTORY

В schema присутствуют 28 прикладных таблиц и 13 migration files от `0000` до `0012`.

| Таблица                     | Назначение                                                      |
| --------------------------- | --------------------------------------------------------------- |
| `users`                     | Пользовательские identities и Argon2id password hash            |
| `sessions`                  | Seller opaque session hashes, CSRF binding, expiry и revocation |
| `shops`                     | Магазины и moderation/publication status                        |
| `subscriptions`             | Текущее состояние подписки и billing period                     |
| `payment_attempts`          | История initial/recurring attempts и idempotency                |
| `payment_provider_bindings` | Неизменяемая связь invoice/provider identity с subscription     |
| `subscription_payments`     | Подтверждённые subscription receipts                            |
| `shop_members`              | Tenant membership и seller role                                 |
| `password_reset_tokens`     | Hash, expiry и consumption reset token                          |
| `auth_rate_limits`          | Expiring hashed rate-limit buckets                              |
| `admin_accounts`            | Admin role, MFA state и capability flags                        |
| `admin_sessions`            | Отдельные короткие admin sessions                               |
| `audit_logs`                | Append-only critical action history                             |
| `moderation_cases`          | Текущий moderation case магазина                                |
| `moderation_history`        | Append-only moderation decisions                                |
| `analytics_events`          | Минимальные first-party events без PII payload                  |
| `media_objects`             | Object Storage lifecycle и orphan cleanup state                 |
| `categories`                | Иерархия категорий                                              |
| `brands`                    | Справочник брендов                                              |
| `products`                  | Основная карточка товара, price/status/search document          |
| `product_drafts`            | Seller drafts и optimistic version                              |
| `product_variants`          | Size, color, optional SKU, price override и availability        |
| `product_images`            | Product media references и order                                |
| `shop_locations`            | Address, mall, canonical 2GIS URL, coordinates                  |
| `shop_images`               | Shop logo и cover references                                    |
| `seller_onboarding`         | Persisted onboarding progress                                   |
| `shop_contacts`             | Phone, normalized WhatsApp и optional Instagram                 |
| `customer_requests`         | Lead, consent snapshot, status и deduplication data             |

`request_items` не создана: текущая MVP-заявка привязана к одному товару и optional variant. `favorites` остаётся optional и не реализована. Таблица `notifications` пока не создана, потому что production delivery provider и самостоятельный notification module отсутствуют; это функциональный backlog, а не скрытая готовая возможность.

## F.1. Database integrity

Schema использует foreign keys, unique constraints, check constraints, indexes и transactions. Проверены duplicate ownership, cross-shop references, orphan records, invalid amounts, malformed token hashes, invalid contact values и invalid lifecycle states.

Search использует GIN search vector и trigram matching. Location использует GiST/PostGIS readiness. Analytics report использует composite shop/time index.

# ПРИЛОЖЕНИЕ G. SECURITY CONTROL MATRIX

| Область                | Реализованные controls                                                | Проверка                                         |
| ---------------------- | --------------------------------------------------------------------- | ------------------------------------------------ |
| Passwords              | Argon2id, bounded hashing concurrency, dummy verification             | Unit и integration PASS                          |
| Seller sessions        | 256-bit opaque token, hash-only storage, rotation/revoke/expiry       | PASS                                             |
| Admin sessions         | Отдельная cookie, idle timeout, absolute lifetime, rotation           | PASS                                             |
| Admin MFA              | Encrypted TOTP secret, replay step, hashed recovery codes             | PASS локально; production enrollment не проверен |
| CSRF                   | Exact Origin, fetch-site check, custom header, session-bound token    | PASS                                             |
| Multi-tenancy          | DB membership, permission, locked resource revalidation               | PASS                                             |
| Vertical authorization | Explicit seller/admin permission matrices                             | PASS                                             |
| Rate limiting          | PostgreSQL atomic buckets, signed client pseudonym                    | PASS                                             |
| XSS                    | React escaping, safe JSON-LD, no unsafe content sink                  | PASS; CSP debt открыт                            |
| SSRF                   | No arbitrary URL fetch, fixed provider endpoints, strict 2GIS parsing | PASS                                             |
| SQL injection          | Drizzle parameters, enum sorting, bounded filters                     | PASS                                             |
| Uploads                | Magic/MIME/decode/dimension/pixel/page/timeout limits                 | PASS                                             |
| Audit                  | Append-only triggers, actor/action/resource/result/request ID         | PASS                                             |
| Payments               | Backend amount, immutable binding, unique provider payment ID         | PASS offline; live Halyk BLOCKER                 |
| Secrets                | Ignore rules, examples without values, Gitleaks, Lockbox design       | Repository PASS; production NOT VERIFIED         |
| Containers             | Distroless, non-root, pinned digest, read-only runtime controls       | PASS                                             |

## G.1. Authentication attack coverage

Проверены wrong password, unknown account, enumeration, fixation, replay, expired session, revoked session, disabled account, concurrent rotation, revoke-all race, reset expiry, reset replay, superseded reset token, undelivered reset token, TOTP brute force, TOTP replay и recovery-code storage.

## G.2. Tenant attack coverage

Проверены Seller A → Shop B, Product B, Variant B, CustomerRequest B, Member B, Analytics B, Subscription B, Images B и Settings B. Также проверены Manager/Employee cross-shop attempts, resource identifier substitution и membership revocation during an active operation.

## G.3. Payment attack coverage

Проверены fake frontend success, forged callback, wrong amount, wrong currency, wrong merchant, wrong invoice, wrong subscription, duplicate event, replay, reused provider payment ID, concurrent attempt, delayed status, out-of-order-like observation, initial payment fixture, recurring success, recurring failure и intermediate authorization state.

Эти тесты доказывают безопасность внутренней логики и offline provider contract fixtures. Они не заменяют Halyk acceptance environment.

# ПРИЛОЖЕНИЕ H. EXTERNAL INTEGRATIONS

## H.1. 2GIS

Платный Places API не используется. Продавец сохраняет ссылку на официальную карточку, а backend принимает только согласованный HTTPS domain и canonical firm format. Backend не выполняет fetch по этому URL, поэтому поле не превращается в SSRF primitive.

## H.2. WhatsApp

Используется `wa.me` с нормализованным международным номером. Сообщение включает товар и выбранный вариант и кодируется безопасным URL encoder.

## H.3. Halyk ePay

Интеграция ограничена подпиской продавца. Она никогда не используется для оплаты товара покупателем. Write-side provider остаётся недоступным до выполнения внешнего gate.

## H.4. Freedom Pay

Архитектура позволяет добавить другой `PaymentProvider`, но `FreedomPayProvider` не реализован и не симулируется.

## H.5. Email или SMS

Production delivery provider не выбран. Password-reset request безопасно fail-closed и не создаёт ложное впечатление доставки.

## H.6. Object Storage

Код зависит от S3-compatible contract, а не от proprietary provider API. Local environment использует SeaweedFS; production design рассчитан на private Yandex Object Storage Kazakhstan.

# ПРИЛОЖЕНИЕ I. INFRASTRUCTURE И OPERATIONS

## I.1. Docker images

Multi-stage build отделяет build dependencies от runtime. Финальные образы используют distroless base и непривилегированного пользователя `65532:65532`.

Compose runtime добавляет read-only filesystem, temporary `/tmp`, `cap_drop: ALL`, `no-new-privileges`, init process и healthchecks.

## I.2. Network design

Production design предусматривает:

- публичный HTTPS listener;
- private application subnet;
- private database subnet;
- PostgreSQL без public IP;
- API без прямого public exposure;
- отсутствие публичных SSH, metrics, debug и Swagger endpoints;
- migration runner с отдельной identity и security group.

## I.3. Secret management

Terraform создаёт metadata containers, но не помещает secret payload в state. Application runtime, database migration и object storage credentials разделены. Production значения должны добавляться оператором через Lockbox вне Terraform state и CI logs.

## I.4. Database identities

`qrg_migration` владеет schema и запускает migration job. `qrg_runtime` получает только необходимые data manipulation privileges и не владеет schema. Runtime не должен читать migration secret.

## I.5. Backup design

Terraform source задаёт managed PostgreSQL retention и weekly recovery points. Object Storage использует versioning и encryption. Однако source configuration не считается фактическим backup evidence.

Обязательная independent encrypted copy у второго физически расположенного в Казахстане провайдера отсутствует.

## I.6. Restore design

Runbook требует isolated restore, выбор конкретного restore point, schema and extension validation, row counts, application smoke, media verification, duration measurement и cleanup. Реальный drill не проводился.

## I.7. CI/CD gates

Pipeline предусматривает:

- frozen install;
- secret и infrastructure-as-code scanning;
- source integrity;
- formatting;
- typecheck;
- lint;
- unit/integration/security tests;
- production build;
- dependency audit;
- Terraform validation;
- production image builds;
- HIGH/CRITICAL image scanning.

Production apply, image push, approval, domain, TLS и cloud identity не настроены, поэтому pipeline не выполняет production deployment.

# ПРИЛОЖЕНИЕ J. PRIVACY И DATA GOVERNANCE

## J.1. Data minimization

CustomerRequest ограничена именем, телефоном и данными конкретного обращения. Analytics не содержит raw IP, phone, email, user agent, query string или persistent visitor ID. Card data в систему не поступает.

## J.2. Consent separation

Privacy consent хранит type, version и timestamp. Marketing consent не включён по умолчанию и не подменяется privacy consent. Recurring payment consent не симулируется и должен быть частью подтверждённого банковского процесса.

## J.3. Retention gap

Для analytics предусмотрена bounded retention cleanup. Для CustomerRequest PII пока нет утверждённого business/legal срока и автоматического purge/anonymization. До принятия решения нельзя заявлять завершённую privacy compliance.

## J.4. Kazakhstan residency

Production PostgreSQL, object storage, backups и production logs с персональными данными должны физически оставаться в Казахстане. Фактическое выполнение этого требования нельзя доказать до deployment и проверки второго backup provider.

# ПРИЛОЖЕНИЕ K. SEO, MOBILE, ACCESSIBILITY И PERFORMANCE

## K.1. SEO

Публичные records появляются в metadata и sitemap только при фактической visibility. Development fixtures не индексируются. Structured data не содержит искусственных ratings/reviews и экранируется против script breakout.

## K.2. Mobile

Проверены widths 375, 390 и 430 CSS pixels. Header переходит в компактный режим, category navigation прокручивается горизонтально, catalog filters открываются в bottom drawer, формы и private login pages не создают document-level horizontal overflow.

## K.3. Accessibility

Подтверждены skip link, heading hierarchy, form labels, image alt, focusable native controls, modal focus entry, focus return и visible private-route metadata. Полная проверка screen reader, zoom 200/400 процентов, forced colors и real touch devices не проводилась.

## K.4. Performance

Используются Server Components по умолчанию, bounded API pagination, database indexes, optimized derived images и отсутствие third-party analytics. Проверен индексный SQL plan аналитики. Реальные Core Web Vitals, CDN behavior, concurrent production load и database capacity не измерены.

# ПРИЛОЖЕНИЕ L. ПОЛНАЯ МАТРИЦА ГОТОВНОСТИ

| Подсистема                 | Реализовано       | Проверено локально | Production evidence                   | Итог                |
| -------------------------- | ----------------- | ------------------ | ------------------------------------- | ------------------- |
| Public catalogue           | Да                | Да                 | Нет deployment                        | Код готов           |
| Search and filters         | Да                | Да                 | Нет field metrics                     | Код готов           |
| Product and shop pages     | Да                | Да                 | Нет deployment                        | Код готов           |
| Seller authentication      | Да                | Да                 | Нет real reset delivery               | BLOCKER             |
| Seller authorization       | Да                | Да                 | Нет cloud runtime                     | Код готов           |
| Multi-tenancy              | Да                | Да                 | Integration tests PASS                | READY по коду       |
| Product operations         | Да                | Да                 | Нет production storage                | Код готов           |
| Image pipeline             | Да                | Да                 | Нет production bucket evidence        | NOT VERIFIED внешне |
| CustomerRequest            | Да                | Да                 | Feature flag и privacy decisions      | NEEDS DECISION      |
| WhatsApp                   | Да                | Да                 | External app behavior стандартный     | Код готов           |
| 2GIS                       | Да                | Да                 | Paid API не требуется                 | Код готов           |
| Admin Area                 | Да                | Да                 | Production MFA enrollment отсутствует | NOT VERIFIED внешне |
| Moderation                 | Да                | Да                 | Нет production operators              | Код готов           |
| Audit log                  | Да                | Да                 | Runtime grants ещё не применены       | NOT VERIFIED внешне |
| Subscription state machine | Да                | Да                 | Provider write flow отключён          | Код готов           |
| Halyk payment              | Architecture only | Offline fixtures   | Нет acceptance                        | BLOCKER             |
| Analytics                  | Да                | Да                 | Нет production anomaly alerts         | NEEDS FIX           |
| SEO                        | Да                | Да                 | Нужен real domain                     | READY по коду       |
| Containers                 | Да                | Да                 | Не опубликованы в registry            | READY по artifact   |
| Terraform core             | Да                | Validate PASS      | Не применён                           | NOT VERIFIED        |
| Monitoring                 | Runbook only      | Нет live channel   | Нет                                   | BLOCKER             |
| Primary backup             | Source config     | Нет actual backup  | Нет                                   | BLOCKER             |
| Secondary KZ backup        | Нет provider      | Нет                | Нет                                   | BLOCKER             |
| Restore                    | Runbook only      | Нет drill          | Нет                                   | BLOCKER             |
| Privacy/residency          | Partial controls  | Code checks PASS   | Нет legal/deployment evidence         | BLOCKER             |

# ПРИЛОЖЕНИЕ M. ПОЛНЫЙ ПЛАН СНЯТИЯ PRODUCTION BLOCKERS

## M.1. Password reset

1. Выбрать допустимого provider.
2. Подтвердить processing location и договорные условия.
3. Создать adapter без изменения reset token model.
4. Поместить credentials в Lockbox.
5. Настроить redacted delivery logs.
6. Проверить доставку на acceptance accounts.
7. Повторить expiry, replay, enumeration и revoke-all tests.

Критерий завершения: письмо или SMS фактически доставляется, token используется один раз, secrets и token не появляются в logs.

## M.2. Halyk ePay

1. Получить merchant account и acceptance credentials.
2. Получить у банка точный callback verification contract.
3. Зафиксировать merchant identifiers, endpoints, currencies и recurring mandate rules.
4. Реализовать недостающую проверку без выдуманных fields.
5. Провести initial payment в acceptance environment.
6. Провести recurring success и failure.
7. Проверить duplicate, replay, delayed и out-of-order delivery.
8. Сверить provider statements с immutable internal ledger.

Критерий завершения: subscription активируется только после подтверждённого server-to-server provider truth.

## M.3. Production cloud

1. Предоставить Yandex Cloud organization, folder и billing approval.
2. Подготовить remote encrypted Terraform state.
3. Выполнить reviewed plan.
4. Применить KMS, Lockbox, network, database, bucket и registry resources.
5. Добавить compute/runtime, HTTPS load balancer, DNS и certificate.
6. Проверить отсутствие public PostgreSQL/API/SSH/metrics/debug ports.
7. Опубликовать images по immutable digest.

Критерий завершения: cloud inventory и внешний scan соответствуют network design.

## M.4. Database privilege bootstrap

1. Создать разные generated passwords для migration и runtime roles.
2. Выполнить role bootstrap через защищённый канал.
3. Сохранить URLs в разные Lockbox secrets.
4. Запустить migration job отдельной identity.
5. Применить post-migration grants.
6. Проверить отсутствие schema ownership и immutable-ledger mutations у runtime.

Критерий завершения: runtime application работает с минимальными grants и не может выполнить DDL или tamper audit/payment ledgers.

## M.5. Admin production bootstrap

1. Назначить ограниченное число уполномоченных администраторов.
2. Передать temporary password защищённым каналом.
3. Обязать change password.
4. Выполнить TOTP enrollment.
5. Передать recovery codes вне application logs.
6. Проверить revoke и last-super-admin protections.

Критерий завершения: ни один production admin не имеет privileged access без завершённого MFA.

## M.6. Monitoring

1. Создать notification channel и on-call ownership.
2. Настроить uptime, 5xx, latency, CPU, memory, disk, database, storage, auth anomaly и payment/webhook alerts.
3. Связать alerts с runbooks.
4. Сгенерировать controlled test signals.
5. Зафиксировать delivery и acknowledgement evidence.

Критерий завершения: alert достигает ответственного человека в установленное время.

## M.7. Backup и restore

1. Подтвердить существование managed backups и point-in-time recovery window.
2. Выбрать второго provider с физическим хранением в Казахстане.
3. Настроить encrypted/versioned independent copy.
4. Выполнить isolated Yandex restore.
5. Выполнить isolated independent-copy restore.
6. Проверить schema, extensions, counts, application flows, media и checksums.
7. Зафиксировать фактические recovery point objective и recovery time objective.

Критерий завершения: имеются датированные результаты двух успешных restore drills.

## M.8. Privacy и residency

1. Утвердить data inventory и owners.
2. Утвердить CustomerRequest retention.
3. Реализовать purge или anonymization.
4. Утвердить data subject request procedure.
5. Проверить расположение database, storage, logs, primary backup и secondary backup.
6. Проверить договоры processors.
7. Зафиксировать policy versions и production consent text.

Критерий завершения: существует юридически и технически подтверждённая цепочка обработки персональных данных в Казахстане.

## M.9. Финальный go/no-go

После снятия всех blockers необходимо повторно выполнить:

```text
source integrity
format check
typecheck
lint
unit tests
integration tests
security tests
production build
Terraform plan review
container build and scan
production smoke
external exposure scan
Halyk acceptance tests
password reset delivery test
alert delivery test
backup evidence check
restore drill review
privacy and residency sign-off
```

Только после получения документированных доказательств для каждого пункта допустимо изменить итог с `PRODUCTION LAUNCH = NOT ALLOWED` на `PRODUCTION LAUNCH = ALLOWED`.

# ПРИЛОЖЕНИЕ N. ИСКЛЮЧЁННЫЕ И НЕЗАВЕРШЁННЫЕ ВОЗМОЖНОСТИ

Осознанно не реализованы:

- оплата товара через QRG MARKET;
- seller wallet;
- payouts;
- escrow;
- buyer payment transactions;
- комиссия с товарной продажи;
- доставка QRG;
- reviews и искусственные ratings;
- сложная warehouse management system;
- reservation inventory;
- mobile application;
- loyalty system;
- artificial-intelligence recommendations;
- artificial-intelligence image search;
- Elasticsearch или OpenSearch;
- microservices и Kubernetes;
- Freedom Pay integration;
- favorites;
- notifications delivery module.

Их отсутствие не должно маскироваться фиктивными данными или production mocks. Любая такая возможность требует отдельного бизнес-решения и новой явно заданной фазы.

# ПРИЛОЖЕНИЕ O. ОКОНЧАТЕЛЬНОЕ ЗАКЛЮЧЕНИЕ ПО ПРОЕКТУ

QRG MARKET имеет целостный foundation, рабочие публичные страницы, каталог, seller operations, CustomerRequest flow, Admin Area, moderation, subscription state machine, first-party analytics, production-oriented container artifacts и validated infrastructure source.

Authentication, authorization и tenant isolation имеют сильное автоматизированное покрытие. Финальный аудит не оставил открытых технически исправимых CRITICAL или HIGH findings. Архитектура не нарушает ключевую бизнес-границу: деньги за товар никогда не проходят через QRG MARKET.

Проект ещё не является запущенным production-сервисом. Реальная готовность зависит от внешних банковских, cloud, delivery, monitoring, backup, restore, privacy и residency доказательств. До их получения итог остаётся неизменным:

**PRODUCTION LAUNCH = NOT ALLOWED.**
