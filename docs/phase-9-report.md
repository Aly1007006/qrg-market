# PHASE 9 — Production infrastructure, Kazakhstan deployment and disaster recovery

**PHASE 9 STATUS: BLOCKED**

The repository now contains a validated production infrastructure baseline and hardened production images. Nothing was applied to Yandex Cloud and no public production endpoint was created because production cloud credentials, a domain, a monitoring destination, and an approved independent Kazakhstan backup provider were not supplied. `CONFIGURED` below never means `DEPLOYED` or `VERIFIED`.

## 1. Architecture

`Internet → HTTPS ALB → qrg-web → private qrg-api → private Managed PostgreSQL` is the documented target. Images are stored in Container Registry, media in private Object Storage, secret material in Lockbox, and structured logs in Cloud Logging. Browser-to-database and browser-to-private-API access are excluded.

## 2. Actual resources created

No cloud resources were created and no Terraform apply was attempted. Locally, the phase produced validated Terraform configuration, runbooks, two production images, and disposable smoke-test containers. The local images are `qrg-api:phase9` (`884cab3a97b3`, 78 MB) and `qrg-web:phase9` (`17189534611c`, 85 MB).

Main changed or created files:

- `.github/workflows/ci.yml`
- `.gitignore`
- `Dockerfile`
- `compose.yaml`
- `apps/api/.env.production.example`
- `apps/web/.env.production.example`
- `infra/terraform/environments/production/*`
- `docs/operations/production-architecture.md`
- `docs/operations/deployment.md`
- `docs/operations/monitoring.md`
- `docs/operations/restore.md`
- `docs/phase-9-report.md`

## 3. Configured but not deployed

Terraform configures the VPC, private subnets, security groups, runtime and migration service accounts, KMS key, Lockbox containers, private media bucket, Container Registry repositories/policies/scanners, Managed PostgreSQL, backup retention policy, and Cloud Logging group. Compute, ALB, Certificate Manager, DNS, monitoring alerts/notification channel, CI cloud identity, and the second-provider backup are deliberately not represented by fake values.

## 4. Region and zone

The provider endpoints and all configured zonal resources target Kazakhstan and `kz1-a`. Yandex documents `kz1-a` as the current Kazakhstan availability zone; the configuration does not claim any nonexistent Kazakhstan Multi-AZ placement.

## 5. One-zone risk

Both proposed PostgreSQL hosts are in `kz1-a`. This can reduce individual host failure risk but does not protect against a zone outage. A second encrypted copy with an independent provider in Kazakhstan and a verified restore are mandatory before launch.

## 6. Network

`CONFIGURED, NOT DEPLOYED`: separate application and database private subnets and security groups. The database has no public IP. Runtime and migration access are separated.

## 7. Public endpoints

Only ALB TCP/443 is permitted from the Internet in the configured rules. API, PostgreSQL, debug, metrics, container runtime, and SSH have no public ingress rule. No endpoint currently exists.

## 8. Security groups

`CONFIGURED, NOT DEPLOYED`: ALB receives 443; application receives 3000 only from the ALB group; PostgreSQL receives 6432 only from application and migration groups. Egress is explicit. Terraform validation confirms the rule graph is valid.

## 9. Compute

`BLOCKER`: no compute/instance group was fabricated. The operator must choose and verify a Kazakhstan-available runtime that supports private networking, immutable image digests, Lockbox delivery, health checks, SIGTERM, log forwarding, and the required residency controls.

## 10. qrg-web

The final image uses patched Node 24.21.0 copied into a digest-pinned shell-less `distroless/cc-debian12:nonroot` runtime. It runs as UID/GID 65532, has a built-in health check and SIGTERM stop signal, and passed a read-only, no-capabilities, no-new-privileges HTTP smoke test.

## 11. qrg-api

The API uses the same hardened runtime. It runs as UID/GID 65532, exposes liveness/readiness, and passed a live database readiness check under a read-only root filesystem with all Linux capabilities dropped. Migration uses the same immutable image with a separate command and identity.

## 12. Container Registry

`CONFIGURED, NOT DEPLOYED`: private `qrg-web` and `qrg-api` repositories, lifecycle retention, scan-on-push and weekly scans, and pull-only runtime/migration IAM bindings. Images were not pushed because no registry or CI identity exists yet.

## 13. PostgreSQL

`CONFIGURED, NOT DEPLOYED`: Managed PostgreSQL 17, two private hosts in `kz1-a`, KMS disk encryption, deletion protection, maintenance window, no DataLens/WebSQL/Serverless/Yandex Query access, 14-day automatic backup retention, and weekly 30-day recovery points. The preset and disk type must be selected from the live Kazakhstan catalog before planning. Application database/user creation stays outside Terraform so passwords do not enter state. **Database schema/migrations: изменений нет.**

## 14. Object Storage

`CONFIGURED, NOT DEPLOYED`: private media bucket, anonymous read/list/config disabled, versioning enabled, KMS encryption enabled, TLS S3 endpoint `https://storage.yandexcloud.kz`, region `kz1`, and no public website hosting.

## 15. Lockbox

`CONFIGURED, NOT DEPLOYED`: separate application and Object Storage credential secret containers. Terraform creates only secret metadata; application secret payloads are operator-injected. The Object Storage static key is written by the provider directly to Lockbox and is not emitted as a Terraform output.

## 16. IAM

`CONFIGURED, NOT DEPLOYED`: separate runtime and migration service accounts, bucket-scoped runtime access, registry pull-only access, and KMS usage grants. CI push/scan identity and Terraform operator federation remain unspecified; blanket `admin` is not required or recommended.

## 17. TLS

`BLOCKER`: no production domain was supplied, so Certificate Manager validation, certificate creation, HTTPS listener binding, HSTS launch behavior, and renewal monitoring cannot be deployed or verified.

## 18. DNS

`BLOCKER`: domain ownership, DNS zone, and production records were not supplied. No placeholder production DNS was created.

## 19. Load balancer

`BLOCKER`: the network contract and ALB security group are configured, but ALB target groups/listener/routing cannot be completed until compute and domain/TLS decisions exist.

## 20. Monitoring

The runbook defines availability, readiness, HTTP 5xx, latency, restart, CPU, memory, disk, PostgreSQL connection/replication/backup, certificate-expiry, failed CI, registry vulnerability, backup-copy, and restore-test signals. Monitoring resources were not claimed as deployed.

## 21. Alerts

`BLOCKER`: no verified notification channel or escalation contacts were provided. The runbook contains suggested severity and routing, but actual delivery has not been tested.

## 22. Logging

`CONFIGURED, NOT DEPLOYED`: a 30-day Cloud Logging group. Application logging remains structured with request IDs; policy excludes credentials, authorization headers, payment/card data, raw customer-request bodies, and unnecessary full phone numbers.

## 23. CI/CD

GitHub Actions now runs source integrity, formatting, typecheck, lint, unit tests, database/integration tests, smoke tests, production build, production dependency audit, Terraform validation, repository secret/IaC scanning, image builds, and HIGH/CRITICAL image scans. Third-party actions are SHA-pinned. Deployment/push is intentionally absent until a short-lived/federated least-privilege Yandex identity and protected environment are supplied.

## 24. Container security

Both final images are digest-based, non-root, shell-less production runtimes with health checks and SIGTERM support. Local runtime verification used read-only root filesystems, `/tmp` tmpfs, `cap_drop=ALL`, and `no-new-privileges`. Docker Scout found `0 CRITICAL / 0 HIGH` in each final image. An initially tested Debian Node runtime had 2 CRITICAL/15 HIGH findings; a stock distroless Node runtime had 8 HIGH findings; neither was accepted. A musl scratch experiment was also rejected after an API native-module crash. The final glibc-compatible distroless design passed both runtime and scan gates.

## 25. Database backups

`CONFIGURED, NOT DEPLOYED`: daily managed backups with 14-day retention plus weekly recovery points retained for 30 days. Backup presence and job success cannot be verified before deployment.

## 26. PITR

Yandex Managed PostgreSQL supports point-in-time restore within the retained backup window. Configuration prerequisites are present, but an actual PITR operation was not executed and must not be treated as verified.

## 27. Secondary Kazakhstan backup

`BLOCKER`: no independent Kazakhstan provider, account, bucket, encryption key, or credentials were supplied. The required design is a versioned, encrypted, access-isolated copy outside the Yandex failure domain, with deletion protection where supported.

## 28. Restore procedure

The restore runbook covers incident declaration, clean target provisioning, managed PostgreSQL/PITR restore, independent-copy restore, integrity checks, extensions/migrations, application smoke tests, controlled traffic cutover, and evidence capture. It explicitly forbids overwriting production during a drill.

## 29. Restore test

`NOT EXECUTED`: there is no deployed production backup and no approved second-provider target/credentials. A real timed restore to an isolated environment remains a production blocker.

## 30. RPO

Provisional target, not verified: up to 10 minutes for failures recoverable through primary PITR and up to 24 hours for a zone/provider disaster using the independent KZ copy. The business owner and providers must approve these values after a measured drill.

## 31. RTO

Provisional target, not verified: 4 hours for a primary managed restore and 8 hours for a zone/provider disaster. These are targets, not achieved metrics; only a timed restore test can verify them.

## 32. Halyk

The production Halyk provider remains release-gated. No credentials are present, no buyer payment flow is introduced, frontend redirects cannot activate subscriptions, and subscription payment enablement still requires accepted official merchant callback/recurring behavior and real merchant configuration.

## 33. Password reset

Production reset delivery remains unavailable by design until an approved Kazakhstan-compatible email/SMS provider, sender identity, credentials, delivery monitoring, and privacy/logging behavior are configured and tested. The application does not report a fake successful delivery.

## 34. Data residency

Primary Terraform endpoints and resources target Kazakhstan. Actual residency is not verified because nothing is deployed, production logging is not connected, and the independent KZ backup provider has not been selected. Cross-border CI logs must continue to contain no personal data or secrets.

## 35. Secret scan

Gitleaks 8.30.1 was downloaded from the official release and its Windows archive SHA-256 matched the official checksum. The exact staged Phase 9 patch returned zero findings. A full working-directory scan found 18 matches only in ignored paths: one local `apps/api/.env`, generated `.next` artifacts, and the ignored scanner package itself. Those paths are confirmed ignored and untracked; no secret value was printed. CI also fails on Trivy secret/misconfiguration findings.

## 36. Tests

Final unit tests: 87/87 passed (API 61, Web 26). Database/integration suites executed during the phase: 125/125 passed. Smoke suites: 75/75 passed. Typecheck passed. Lint and Prettier passed. Terraform `fmt -check` and `validate` passed. Production dependency audit reported no known vulnerabilities. One source-integrity invocation initially hit the Windows Git ownership guard; rerunning with a process-scoped `safe.directory` override passed for 188 files. Earlier database/catalog/production smoke invocations with incomplete local environment variables were corrected and all final invocations passed; no test was removed or disabled.

## 37. Production build

`pnpm build` passed for NestJS and Next.js 16.3.4. Public, seller, admin, catalog, product, shop, robots, sitemap, and BFF routes compiled successfully.

## 38. Docker build

Both final targets built successfully from digest-pinned bases. Runtime health: API `healthy`, Web `healthy`; API readiness HTTP 200 and Web HTTP 200. Final vulnerability scans: API `0C/0H`, Web `0C/0H`.

## 39. Known issues

- Production resources and connectivity are not deployed or verified.
- No domain/TLS/DNS/ALB or monitoring notification channel exists.
- No independent Kazakhstan backup target or restore evidence exists.
- Production Halyk merchant behavior and password-reset delivery remain blocked.
- A real compute runtime and Kazakhstan-available PostgreSQL preset/disk type still require live catalog decisions.

## 40. Technical debt

- Compute/ALB/DNS/TLS/alert Terraform modules await real identifiers and platform selection; this is intentional incomplete infrastructure, not hidden placeholder automation.
- RPO/RTO are provisional until measured.
- Application and database bootstrap secrets require an operator-run, auditable procedure after Lockbox deployment.
- Terraform state serialization/locking behavior must be verified for the chosen Kazakhstan state backend and CI identity.

## 41. Blockers and gate status

| Gate           | Status       | Reason                                                                    |
| -------------- | ------------ | ------------------------------------------------------------------------- |
| INFRASTRUCTURE | BLOCKER      | No cloud credentials, compute choice, plan, or apply                      |
| NETWORK        | NOT VERIFIED | Valid configuration, not deployed                                         |
| DATABASE       | NOT VERIFIED | Valid private configuration, no live cluster                              |
| STORAGE        | NOT VERIFIED | Valid private/KMS/versioned configuration, no live bucket                 |
| SECRETS        | NOT VERIFIED | Lockbox structure configured, payload delivery not deployed               |
| TLS            | BLOCKER      | Domain and validation unavailable                                         |
| BACKUPS        | BLOCKER      | Primary config not deployed; secondary KZ provider absent                 |
| RESTORE        | BLOCKER      | No real backup/credentials; restore test not executed                     |
| MONITORING     | BLOCKER      | Notification channel and live metrics unavailable                         |
| LOGGING        | NOT VERIFIED | Logging group configured, ingestion not deployed                          |
| CI/CD          | NEEDS FIX    | Quality pipeline ready; protected cloud identity/deploy stage absent      |
| CONTAINERS     | READY        | Hardened runtime, health checks, 0 HIGH/CRITICAL scans                    |
| DATA RESIDENCY | BLOCKER      | Primary target is KZ, but deployment and secondary KZ copy are unverified |

Next recommended phase: complete the blocked Phase 9 deployment prerequisites, execute a reviewed Terraform plan/apply, and run a timed isolated restore drill. Do not start PHASE 10 until every production gate above is independently verified.
