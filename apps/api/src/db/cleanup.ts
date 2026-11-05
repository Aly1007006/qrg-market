import { sql } from 'drizzle-orm';
import type { Transaction } from '../database.js';

export interface CleanupOptions {
  readonly customerRequestRetentionDays?: number | null;
  readonly customerRequestBatchSize?: number;
  readonly now?: Date;
}

// Materialize each batch once: a nested-loop IN subquery can re-scan after
// mutations and otherwise exceed LIMIT. No user/shop deletion.
export async function cleanupExpired(
  client: Pick<Transaction, 'execute'>,
  options: CleanupOptions = {},
) {
  const analytics = await client.execute(sql`WITH due AS MATERIALIZED (
    SELECT id FROM analytics_events WHERE created_at < now() - interval '100 days'
    ORDER BY created_at LIMIT 10000 FOR UPDATE SKIP LOCKED
  ) DELETE FROM analytics_events USING due WHERE analytics_events.id = due.id`);
  const rate = await client.execute(sql`WITH due AS MATERIALIZED (
    SELECT key_hash FROM auth_rate_limits WHERE window_ends_at < now() - interval '1 day' LIMIT 1000 FOR UPDATE SKIP LOCKED
  ) DELETE FROM auth_rate_limits USING due WHERE auth_rate_limits.key_hash = due.key_hash`);
  const resets = await client.execute(sql`WITH due AS MATERIALIZED (
    SELECT id FROM password_reset_tokens WHERE expires_at < now() - interval '1 day' LIMIT 1000 FOR UPDATE SKIP LOCKED
  ) DELETE FROM password_reset_tokens USING due WHERE password_reset_tokens.id = due.id`);
  const expiredSessions = await client.execute(sql`WITH due AS MATERIALIZED (
    SELECT id FROM sessions WHERE expires_at < now() - interval '30 days' LIMIT 1000 FOR UPDATE SKIP LOCKED
  ) DELETE FROM sessions USING due WHERE sessions.id = due.id`);
  const expiredAdminSessions =
    await client.execute(sql`WITH due AS MATERIALIZED (
    SELECT id FROM admin_sessions WHERE expires_at < now() - interval '30 days' LIMIT 1000 FOR UPDATE SKIP LOCKED
  ) DELETE FROM admin_sessions USING due WHERE admin_sessions.id = due.id`);
  const retentionDays = options.customerRequestRetentionDays ?? null;
  const batchSize = options.customerRequestBatchSize ?? 500;
  if (
    retentionDays !== null &&
    (!Number.isInteger(retentionDays) ||
      retentionDays < 1 ||
      retentionDays > 3650)
  ) {
    throw new Error('Invalid customer request retention period');
  }
  if (!Number.isInteger(batchSize) || batchSize < 1 || batchSize > 1000) {
    throw new Error('Invalid customer request cleanup batch size');
  }
  let erasedCustomerRequests = 0;
  if (retentionDays !== null) {
    const now = options.now ?? new Date();
    if (Number.isNaN(now.getTime())) throw new Error('Invalid cleanup clock');
    const cutoff = new Date(now.getTime() - retentionDays * 86_400_000);
    const erased = await client.execute(sql`
      WITH due_requests AS MATERIALIZED (
        SELECT id FROM customer_requests
        WHERE created_at < ${cutoff}
          AND legal_hold = false
          AND personal_data_erased_at IS NULL
        ORDER BY created_at, id
        LIMIT ${batchSize}
        FOR UPDATE SKIP LOCKED
      )
      UPDATE customer_requests
      SET name = 'Данные удалены',
          phone = '+10000000000',
          pickup_preference = NULL,
          comment = NULL,
          submission_hash = md5('erased-submission:' || customer_requests.id::text) || md5('erased-submission-2:' || customer_requests.id::text),
          dedup_hash = md5('erased-dedup:' || customer_requests.id::text) || md5('erased-dedup-2:' || customer_requests.id::text),
          personal_data_erased_at = ${now}
      FROM due_requests
      WHERE customer_requests.id = due_requests.id
    `);
    erasedCustomerRequests = erased.rowCount ?? 0;
  }
  return {
    analyticsEvents: analytics.rowCount ?? 0,
    rateBuckets: rate.rowCount ?? 0,
    resetTokens: resets.rowCount ?? 0,
    sessions: expiredSessions.rowCount ?? 0,
    adminSessions: expiredAdminSessions.rowCount ?? 0,
    erasedCustomerRequests,
  };
}
