# Production PostgreSQL roles

QRG production uses two database identities with distinct generated passwords:

- `qrg_migration` owns the application schema and runs Drizzle migrations only;
- `qrg_runtime` is used by the API and can read or mutate application rows, but cannot change schema or tamper with immutable ledgers.

Create both through the approved one-shot bootstrap channel. Supply passwords using protected `psql` variables or an equivalent secret-safe mechanism; never put them in a command line, shell history, Terraform, repository file, plan, or log. Store the runtime URL only in the application Lockbox secret and the owner URL only in the migration Lockbox secret.

Run the following as the managed PostgreSQL administrative user after creating database `qrg_market`. Replace role creation syntax with the provider-approved secret-safe bootstrap mechanism:

```sql
REVOKE CREATE ON SCHEMA public FROM PUBLIC;
REVOKE ALL ON DATABASE qrg_market FROM PUBLIC;

GRANT CONNECT ON DATABASE qrg_market TO qrg_migration, qrg_runtime;
GRANT USAGE, CREATE ON SCHEMA public TO qrg_migration;
GRANT USAGE ON SCHEMA public TO qrg_runtime;

ALTER DEFAULT PRIVILEGES FOR ROLE qrg_migration IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO qrg_runtime;
ALTER DEFAULT PRIVILEGES FOR ROLE qrg_migration IN SCHEMA public
  GRANT USAGE, SELECT, UPDATE ON SEQUENCES TO qrg_runtime;
```

After every migration, run these grants as `qrg_migration` so existing and newly introduced objects remain consistent:

```sql
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO qrg_runtime;
GRANT USAGE, SELECT, UPDATE ON ALL SEQUENCES IN SCHEMA public TO qrg_runtime;

REVOKE UPDATE, DELETE, TRUNCATE ON audit_logs FROM qrg_runtime;
REVOKE UPDATE, DELETE, TRUNCATE ON moderation_history FROM qrg_runtime;
REVOKE UPDATE, DELETE, TRUNCATE ON subscription_payments FROM qrg_runtime;
REVOKE UPDATE, DELETE, TRUNCATE ON payment_provider_bindings FROM qrg_runtime;
```

The API legitimately appends rows to immutable ledgers, so `INSERT` remains granted. Database triggers are a second line of defense; runtime grants are the primary least-privilege boundary. Verify before each release that `qrg_runtime` is `NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION`, owns no schema/table, cannot read the migration secret, and cannot create or alter objects.

The deployment order is: run migrations with `qrg_migration`, apply the post-migration grants, validate permissions in a transaction, revoke the migration job's runtime access, and only then start application replicas with `qrg_runtime`.
