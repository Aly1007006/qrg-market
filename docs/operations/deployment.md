# Production deployment runbook

## Hard gates

A deployment is forbidden unless all of these are green for the exact commit:

1. source integrity, format, typecheck, lint, unit/integration/security tests, production build, and dependency audit;
2. Terraform format and validate against the locked provider;
3. `qrg-api` and `qrg-web` builds from the same commit;
4. repository secret/misconfiguration scan;
5. HIGH/CRITICAL container scan for both final images;
6. protected production approval and a reviewed Terraform plan;
7. migration compatibility and rollback review;
8. real domain/TLS, alert delivery, primary backup, secondary KZ backup, and restore drill gates.

The current CI implements gates 1–5. Gates 6–8 are **not configured or verified**.

## Immutable release identity

Use the full Git commit SHA as the candidate tag, then deploy the registry digest returned after push. Never deploy `latest`, a branch name, or a mutable semantic tag. Record:

- Git commit and signed release approval;
- `qrg-web@sha256:...` and `qrg-api@sha256:...`;
- reviewed Terraform plan checksum;
- migration image digest and migration result;
- health/smoke result and operator identity.

The runtime must pull only the approved digests. CI publishing needs a dedicated short-lived/federated identity scoped to `container-registry.images.pusher` and `container-registry.images.scanner`. This identity is not configured because no Yandex organization/federation details were supplied.

## Order of operations

1. Freeze the release commit and run all gates.
2. Review and apply the production core plan from a protected, serialized environment.
3. Populate Lockbox out of band; keep Halyk disabled and customer requests disabled until their gates pass.
4. Bootstrap the distinct PostgreSQL migration owner and least-privilege runtime role from `database-roles.md` without putting either password in Terraform state; enable `postgis` and `pg_trgm`.
5. Push and scan both images, then resolve their immutable digests.
6. Start exactly one migration job with the migration service account/security group, migration-only Lockbox secret, and API image digest, overriding the image command with `apps/api/dist/db/migrate-main.js` (the image entrypoint is the pinned Node binary).
7. Stop if migration fails. Do not launch a mixed-schema application fleet.
8. Roll out private application instances gradually; require API readiness and web health.
9. Attach only healthy targets to the HTTPS listener.
10. Run smoke checks for public pages, auth boundary, customer request disabled/enabled state, private API reachability, media access, admin noindex, and subscription/Halyk disabled state.
11. Observe error rate, readiness, database connections, latency, and logs before completing approval.

## Trusted client-address boundary

The public load balancer is the only trusted source of the client-address chain. It must
either replace `X-Forwarded-For` or append the verified peer address as the final entry.
The Next.js service deliberately uses only that final entry when it signs client proof
for the private API; a browser-supplied first entry must never influence throttling.

Production security groups must make the Next.js listener reachable only through the
approved load balancer. Direct Internet access to a compute instance would let a caller
become the nearest apparent proxy and therefore invalidates this trust model. Before a
release, verify with a canary request containing a forged leading `X-Forwarded-For`
value that the signed identity still resolves to the load balancer-appended client
address, and verify that requests without a valid edge address fail closed.

## Rollback

Roll back application images by digest only if the database migration is backward compatible. Database rollback means restore to a new cluster and controlled cutover; never improvise destructive down-migrations in production. If a callback or payment invariant is affected, disable Halyk and stop release traffic before data repair.

## Prohibited operations

- no source copy or `git pull` on a production host;
- no interactive secret entry that lands in shell history;
- no manual migration from a developer laptop;
- no public SSH, API port, PostgreSQL port, metrics, Swagger, or debug endpoint;
- no frontend-controlled subscription amount or success redirect activation;
- no Terraform apply from an unreviewed local plan.
