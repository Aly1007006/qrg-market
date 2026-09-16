import { sql } from 'drizzle-orm';
import type { Transaction } from '../database.js';

// Bounded batches, no user/shop deletion. Repeated execution is safe.
export async function cleanupExpired(client: Pick<Transaction, 'execute'>) {
  await client.execute(sql`DELETE FROM analytics_events WHERE id IN (
    SELECT id FROM analytics_events WHERE created_at < now() - interval '100 days'
    ORDER BY created_at LIMIT 10000 FOR UPDATE SKIP LOCKED
  )`);
  const rate =
    await client.execute(sql`DELETE FROM auth_rate_limits WHERE key_hash IN (
    SELECT key_hash FROM auth_rate_limits WHERE window_ends_at < now() - interval '1 day' LIMIT 1000 FOR UPDATE SKIP LOCKED
  )`);
  const resets =
    await client.execute(sql`DELETE FROM password_reset_tokens WHERE id IN (
    SELECT id FROM password_reset_tokens WHERE expires_at < now() - interval '1 day' LIMIT 1000 FOR UPDATE SKIP LOCKED
  )`);
  const expiredSessions =
    await client.execute(sql`DELETE FROM sessions WHERE id IN (
    SELECT id FROM sessions WHERE expires_at < now() - interval '30 days' LIMIT 1000 FOR UPDATE SKIP LOCKED
  )`);
  const expiredAdminSessions =
    await client.execute(sql`DELETE FROM admin_sessions WHERE id IN (
    SELECT id FROM admin_sessions WHERE expires_at < now() - interval '30 days' LIMIT 1000 FOR UPDATE SKIP LOCKED
  )`);
  return {
    rateBuckets: rate.rowCount ?? 0,
    resetTokens: resets.rowCount ?? 0,
    sessions: expiredSessions.rowCount ?? 0,
    adminSessions: expiredAdminSessions.rowCount ?? 0,
  };
}
