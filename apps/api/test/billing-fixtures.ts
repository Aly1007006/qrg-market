// Test-only paid-access fixture for existing public catalog/upload/lead regressions.
import { inArray } from 'drizzle-orm';
import type { Database } from '../src/database.js';
import {
  subscriptions,
  subscriptionPayments,
  paymentAttempts,
  paymentProviderBindings,
} from '../src/db/schema.js';
import { nextMonth } from '../src/subscriptions/state.js';
function guard() {
  if (!new URL(process.env.DATABASE_URL ?? '').pathname.endsWith('_test'))
    throw new Error('Test DB required');
}
export async function paidFixtures(db: Database, shopIds: string[]) {
  guard();
  const start = new Date();
  await db.client
    .insert(subscriptions)
    .values(
      shopIds.map((shopId) => ({
        shopId,
        status: 'ACTIVE' as const,
        periodStart: start,
        periodEnd: nextMonth(start, start.getUTCDate()),
        anchorDay: start.getUTCDate(),
        cycle: 1,
      })),
    )
    .onConflictDoNothing();
}
export async function removeBillingFixtures(db: Database, shopIds: string[]) {
  guard();
  const ids = (
    await db.client
      .select({ id: subscriptions.id })
      .from(subscriptions)
      .where(inArray(subscriptions.shopId, shopIds))
  ).map((s) => s.id);
  if (!ids.length) return;
  await db.client
    .delete(paymentProviderBindings)
    .where(inArray(paymentProviderBindings.subscriptionId, ids));
  await db.client
    .delete(subscriptionPayments)
    .where(inArray(subscriptionPayments.subscriptionId, ids));
  await db.client
    .delete(paymentAttempts)
    .where(inArray(paymentAttempts.subscriptionId, ids));
  await db.client.delete(subscriptions).where(inArray(subscriptions.id, ids));
}
