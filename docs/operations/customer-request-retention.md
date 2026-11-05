# CustomerRequest PII retention

`CustomerRequest` is a buyer-to-seller lead, not a paid order. It contains a
name, normalized phone number and optional free-text comment, so it requires an
explicitly approved retention period.

## Production gate

There is deliberately no production retention default. When
`CUSTOMER_REQUESTS_ENABLED=true`, startup also requires
`CUSTOMER_REQUEST_RETENTION_DAYS` to be an integer from 1 through 3650. The
number must come from the approved Kazakhstan privacy/legal retention schedule;
operators must not choose it merely to make configuration validation pass.

Run `pnpm db:cleanup` from a scheduled, single-purpose job using the runtime
database identity. The job processes at most 500 eligible requests per run and
may be repeated until `erasedCustomerRequests` is zero. Concurrent workers use
`FOR UPDATE SKIP LOCKED`, and already-erased rows are ignored.

## What erasure preserves

The job replaces the customer name and phone with non-personal sentinels,
clears pickup preference and comment, and replaces submission/deduplication
hashes with request-ID-derived values. It records `personal_data_erased_at`.
It preserves the request ID, shop/product snapshots, consent type/version/time,
communication status and staff actor so audit and aggregate analytics remain
consistent. It never writes customer PII to logs or analytics.

## Legal hold

`customer_requests.legal_hold` is false by default and is not exposed through
seller, public or admin HTTP contracts. A formally authorized operator may set
it through the controlled database operations process before the row becomes
eligible. Held rows are excluded from erasure. Releasing a hold requires the
same approved process; database access evidence and the reason belong in the
external compliance/audit system. A seller cannot create or remove a hold.

## Verification and limits

- Monitor only aggregate job counts; never export request bodies.
- Alert on repeated job failure and an increasing eligible-row backlog.
- Test a bounded batch, a held row and a repeat run after every migration.
- Database erasure does not by itself remove older backup copies. Backup expiry,
  secondary-provider lifecycle and data-subject-request evidence remain
  operational/legal production gates.
