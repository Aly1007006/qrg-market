import { eq, sql, type SQL, type AnyColumn } from 'drizzle-orm';
import { shops, subscriptions } from '../db/schema.js';
import type { Transaction } from '../database.js';
import { entitled, type BillingState } from './state.js';
export function subscriptionVisible(shopId: SQL | AnyColumn): SQL {
  return sql`EXISTS (SELECT 1 FROM subscriptions billing WHERE billing.shop_id=${shopId} AND (
    (billing.status='ACTIVE' AND billing.period_end>now()) OR
    (billing.status='PAST_DUE' AND billing.next_payment_at + interval '120 hours'>now()) OR
    (billing.status='GRACE' AND billing.grace_ends_at>now())))`;
}
// Billing suspension returns a verified shop to VERIFIED, never to an admin SUSPENDED state.
// Renewal therefore cannot clear an administrative suspension/rejection/review.
export async function syncShop(
  tx: Transaction,
  shop: typeof shops.$inferSelect,
  billing: BillingState | null,
  now: Date,
) {
  const allowed = !!billing && entitled(billing, now);
  const status =
    shop.status === 'VERIFIED' && allowed
      ? 'ACTIVE'
      : shop.status === 'ACTIVE' && !allowed
        ? 'VERIFIED'
        : shop.status;
  if (status !== shop.status)
    await tx.update(shops).set({ status }).where(eq(shops.id, shop.id));
  return status;
}
export async function syncModeratedShop(
  tx: Transaction,
  shop: typeof shops.$inferSelect,
) {
  const [billing] = await tx
    .select()
    .from(subscriptions)
    .where(eq(subscriptions.shopId, shop.id))
    .for('update');
  return syncShop(tx, shop, billing ?? null, new Date());
}
