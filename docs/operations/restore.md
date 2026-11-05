# Backup and restore runbook

## Recovery layers

1. Managed PostgreSQL automatic backups: configured in Terraform for 14-day retention with a 02:00 UTC window.
2. Weekly Managed PostgreSQL recovery points: configured for 30-day retention.
3. Object Storage media: private, versioned, KMS-encrypted; noncurrent versions retained for 90 days.
4. Independent encrypted database and media copy at a second provider in Kazakhstan: **not configured** because no provider, contract, endpoint, credentials, retention, or residency evidence was supplied.

Primary Yandex backups and an additional bucket in the same Yandex region do not satisfy the independent-copy requirement.

## Managed PostgreSQL restore drill

Perform the drill in an isolated recovery network/folder using an identity with `managed-postgresql.restorer`; never overwrite the source cluster.

1. Open an incident/change record with the UTC recovery point, source cluster ID, backup ID, operator, and expected data-loss window.
2. List available backups with `yc managed-postgresql backup list` and select a recovery point inside the retained window.
3. Confirm the current command schema with `yc managed-postgresql cluster restore --help` before execution.
4. Restore to a new `PRODUCTION` cluster in `kz1-a`, the private database subnet, with `assign-public-ip=false`, the production database security group, approved preset/disk, and the KMS key. For PITR, pass the UTC point in `yyyy-mm-ddThh:mm:ssZ` format.
5. Wait for healthy status. Do not route the application yet.
6. From an isolated migration/verification runner, verify TLS, database/user presence, schema migration journal, row-count/control totals for critical tables, extensions (`postgis`, `pg_trgm`), foreign keys, and a read-only application smoke test.
7. Verify that no customer phone, session token, password hash, payment secret, authorization header, or card data is copied into logs or the incident ticket.
8. Measure restore start, database-ready, application-ready, and verification-complete timestamps.
9. Delete the drill cluster only after evidence is reviewed and the destroy target is independently confirmed. Keep no plaintext export.

Official command shape and PITR rules: [Yandex Managed PostgreSQL backup documentation](https://yandex.cloud/en/docs/managed-postgresql/operations/cluster-backups).

## Independent-copy restore

The chosen second provider must first be validated for physical Kazakhstan storage, encrypted transport/at-rest storage, immutable/versioned retention, least-privilege credentials, audit logs, and documented deletion. The backup format must be a portable PostgreSQL logical or physical format with a separate manifest containing checksum, source timestamp, PostgreSQL version, schema migration version, encryption-key reference, and object count.

Restore steps, after provider approval:

1. download the encrypted object to an isolated KZ recovery runner;
2. verify provider object checksum and manifest signature before decryption;
3. decrypt only in the isolated runner using a recovery-only key from the approved KZ secret manager;
4. restore into a new private PostgreSQL cluster;
5. run the same integrity/application verification as the managed restore;
6. securely destroy plaintext temporary files and record evidence.

No independent-copy restore test was executed in PHASE 9.

## RPO and RTO

There is no production measurement yet. Therefore no guaranteed RPO or RTO is stated. The configured primary backup retention defines available history, not recovery performance. Initial planning targets may be set only after the first timed restore drill and verification of provider backup cadence; measured values and bottlenecks must replace estimates in this document.
