# Production monitoring and logging gate

The repository configures a 30-day Cloud Logging group and the application already emits structured Nest logs. No notification channel or production resources exist, so no alert is deployed or verified.

Before launch, create alert rules and test delivery for:

- ALB healthy target count below expected capacity;
- HTTP 5xx/error-rate and latency thresholds;
- API readiness failures and restart loops;
- Managed PostgreSQL health, CPU, memory, disk above 80/90%, connection saturation, replication/failover events, and backup failure/age;
- Object Storage authorization/error spikes;
- Container Registry scan with HIGH/CRITICAL findings;
- failed migration or release smoke test;
- abnormal authentication/admin security events;
- Halyk callback verification failures only after merchant integration is approved.

Every alert needs owner, severity, actionable threshold, evaluation window, runbook link, notification destination, escalation timeout, and a recorded test. Avoid per-request high-cardinality labels such as raw IP, phone, email, session token, product free text, or request body.

## Logging rules

- propagate or generate a `request_id` at the application boundary;
- log event name, result, latency, route template, status, and safe resource identifiers;
- never log passwords, password hashes, session/reset tokens, MFA secrets, authorization/cookie headers, S3/Halyk/SMTP secrets, card data, raw customer request bodies, or unmasked phones;
- protect log access with least privilege and keep production logs in Kazakhstan;
- validate redaction with synthetic secrets before enabling traffic.

Log shipping from the not-yet-selected compute runtime to the configured group remains **not configured**.
