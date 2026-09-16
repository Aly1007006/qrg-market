import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { and, desc, eq, sql } from 'drizzle-orm';
import { Database, type Transaction } from '../database.js';
import {
  subscriptions,
  subscriptionPayments,
  paymentAttempts,
  paymentProviderBindings,
  shops,
} from '../db/schema.js';
import { ShopAuthorization } from '../authorization/shop-authorization.js';
import type { Principal } from '../auth/metadata.js';
import { appendAudit } from '../admin/audit.js';
import {
  activate,
  BUSINESS,
  DAY,
  entitled,
  settlePeriod,
  type BillingState,
} from './state.js';
import { syncShop } from './visibility.js';
import { PaymentProvider } from './provider.js';
@Injectable()
export class BillingClock {
  now() {
    return new Date();
  }
}
type Subscription = typeof subscriptions.$inferSelect;
type AttemptKind = typeof paymentAttempts.$inferSelect.kind;
// Trusted INTERNAL event after future adapter verifies provider identity, signature,
// merchant, status and association. Deliberately has no HTTP endpoint or operator success CLI.
export interface ConfirmedPaymentOutcome {
  attemptId: string;
  provider: string;
  providerPaymentId: string;
  amountMinor: number;
  currency: string;
  status: 'SUCCEEDED' | 'FAILED';
}
@Injectable()
export class SubscriptionService {
  constructor(
    @Inject(Database) private readonly db: Database,
    @Inject(ShopAuthorization) private readonly auth: ShopAuthorization,
    @Inject(BillingClock) private readonly clock: BillingClock,
    @Inject(PaymentProvider) private readonly provider: PaymentProvider,
  ) {}
  private async lock(tx: Transaction, shopId: string) {
    const [s] = await tx
      .select()
      .from(subscriptions)
      .where(eq(subscriptions.shopId, shopId))
      .for('update');
    if (!s) throw new NotFoundException();
    return s;
  }
  private async save(
    tx: Transaction,
    s: Subscription,
    state: BillingState,
    action: string,
    actor = 'SYSTEM:billing',
    cycle = s.cycle,
  ) {
    const [updated] = await tx
      .update(subscriptions)
      .set({
        status: state.status,
        periodStart: state.periodStart,
        periodEnd: state.periodEnd,
        anchorDay: state.anchorDay,
        autoRenew: state.autoRenew,
        cancelAtPeriodEnd: state.cancelAtPeriodEnd,
        nextPaymentAt: state.nextPaymentAt,
        graceEndsAt: state.graceEndsAt,
        version: s.version + 1,
        cycle,
      })
      .where(
        and(eq(subscriptions.id, s.id), eq(subscriptions.version, s.version)),
      )
      .returning();
    if (!updated) throw new ConflictException();
    await appendAudit(tx, {
      actor,
      action,
      resource: 'subscription',
      resourceId: s.id,
      result: 'SUCCESS',
    });
    return updated;
  }
  create(p: Principal, shopId: string) {
    return this.auth.withShop(p, shopId, 'subscription.write', async (tx) => {
      const [existing] = await tx
        .select()
        .from(subscriptions)
        .where(eq(subscriptions.shopId, shopId));
      if (existing) return existing;
      const [s] = await tx.insert(subscriptions).values({ shopId }).returning();
      if (!s) throw new Error('Subscription insert failed');
      await appendAudit(tx, {
        actor: 'USER:' + p.userId,
        action: 'SUBSCRIPTION_CREATED',
        resource: 'subscription',
        resourceId: s.id,
        result: 'SUCCESS',
      });
      return s;
    });
  }
  read(p: Principal, shopId: string, page = 1) {
    return this.auth.withShop(p, shopId, 'subscription.read', async (tx) => {
      const [s] = await tx
        .select()
        .from(subscriptions)
        .where(eq(subscriptions.shopId, shopId));
      const attempts = s
        ? await tx
            .select({
              id: paymentAttempts.id,
              kind: paymentAttempts.kind,
              status: paymentAttempts.status,
              amountMinor: paymentAttempts.amountMinor,
              currency: paymentAttempts.currency,
              createdAt: paymentAttempts.createdAt,
              completedAt: paymentAttempts.completedAt,
            })
            .from(paymentAttempts)
            .where(eq(paymentAttempts.subscriptionId, s.id))
            .orderBy(desc(paymentAttempts.createdAt), desc(paymentAttempts.id))
            .limit(20)
            .offset((page - 1) * 20)
        : [];
      return {
        plan: BUSINESS,
        subscription: s
          ? { ...s, status: settlePeriod(s, this.clock.now()).status }
          : null,
        entitled: !!s && entitled(s, this.clock.now()),
        paymentsAvailable: this.provider.available(),
        attempts,
        page,
      };
    });
  }
  disableRenewal(
    p: Principal,
    shopId: string,
    expectedVersion: number,
    cancel: boolean,
  ) {
    return this.auth.withShop(
      p,
      shopId,
      'subscription.write',
      async (tx, shop) => {
        const s = await this.lock(tx, shopId);
        if (s.version !== expectedVersion) throw new ConflictException();
        const now = this.clock.now();
        let state: BillingState = {
          ...s,
          autoRenew: false,
          cancelAtPeriodEnd: cancel || s.cancelAtPeriodEnd,
        };
        if (state.status === 'ACTIVE')
          state = { ...state, nextPaymentAt: null };
        if (state.status === 'PAST_DUE' && state.nextPaymentAt)
          state = {
            ...state,
            status: 'GRACE',
            graceEndsAt: new Date(state.nextPaymentAt.getTime() + 5 * DAY),
            nextPaymentAt: null,
          };
        // A cancellation after paid access expired takes effect immediately.
        if (cancel && (!s.periodEnd || s.periodEnd <= now))
          state = {
            ...state,
            status: 'CANCELLED',
            nextPaymentAt: null,
            graceEndsAt: null,
          };
        const updated = await this.save(
          tx,
          s,
          settlePeriod(state, now),
          cancel ? 'SUBSCRIPTION_CANCEL' : 'SUBSCRIPTION_DISABLE_RENEW',
          'USER:' + p.userId,
        );
        await syncShop(tx, shop, updated, now);
        return updated;
      },
    );
  }
  requestRenewal(p: Principal, shopId: string) {
    return this.auth.withShop(p, shopId, 'subscription.write', () =>
      this.provider.createInitialPayment(),
    );
  }
  private withShop<T>(
    shopId: string,
    operation: (
      tx: Transaction,
      shop: typeof shops.$inferSelect,
      s: Subscription,
    ) => Promise<T>,
  ) {
    return this.db.client.transaction(async (tx) => {
      const [shop] = await tx
        .select()
        .from(shops)
        .where(eq(shops.id, shopId))
        .for('update');
      if (!shop) throw new NotFoundException();
      return operation(tx, shop, await this.lock(tx, shopId));
    });
  }
  // Internal durable intent. Reserve before network; the optional persistence hook
  // shares this transaction. It must not perform network I/O. Unknown POST results
  // require provider reconciliation, NOT blind retry (bank idempotency is unconfirmed).
  beginAttempt(
    shopId: string,
    kind: AttemptKind,
    idempotencyKey: string,
    bind?: (
      tx: Transaction,
      attempt: typeof paymentAttempts.$inferSelect,
    ) => Promise<void>,
  ) {
    if (!/^[0-9a-f-]{36}$/.test(idempotencyKey))
      throw new BadRequestException();
    return this.withShop(shopId, async (tx, shop, s) => {
      const [existing] = await tx
        .select()
        .from(paymentAttempts)
        .where(eq(paymentAttempts.idempotencyKey, idempotencyKey));
      if (existing) {
        if (existing.subscriptionId !== s.id || existing.kind !== kind)
          throw new ConflictException();
        if (bind) await bind(tx, existing);
        return existing;
      }
      const now = this.clock.now();
      if (kind === 'INITIAL' && s.periodEnd) throw new ConflictException();
      if (kind !== 'INITIAL' && !s.periodEnd) throw new ConflictException();
      if (
        kind === 'RENEWAL' &&
        s.status === 'ACTIVE' &&
        s.periodEnd &&
        now < s.periodEnd
      )
        throw new ConflictException();
      if (kind === 'RETRY') {
        if (
          s.status !== 'PAST_DUE' ||
          !s.autoRenew ||
          s.cancelAtPeriodEnd ||
          !s.nextPaymentAt ||
          now < s.nextPaymentAt ||
          now.getTime() >= s.nextPaymentAt.getTime() + 5 * DAY
        )
          throw new ConflictException();
        s = await this.save(
          tx,
          s,
          {
            ...s,
            status: 'GRACE',
            graceEndsAt: new Date(s.nextPaymentAt.getTime() + 5 * DAY),
            nextPaymentAt: null,
          },
          'SUBSCRIPTION_RETRY',
        );
        await syncShop(tx, shop, s, now);
      }
      const [pending] = await tx
        .select()
        .from(paymentAttempts)
        .where(
          and(
            eq(paymentAttempts.subscriptionId, s.id),
            eq(paymentAttempts.cycle, s.cycle),
            eq(paymentAttempts.status, 'PENDING'),
          ),
        );
      if (pending) throw new ConflictException();
      const [attempt] = await tx
        .insert(paymentAttempts)
        .values({ subscriptionId: s.id, cycle: s.cycle, kind, idempotencyKey })
        .returning();
      if (!attempt) throw new Error('Attempt insert failed');
      if (bind) await bind(tx, attempt);
      return attempt;
    });
  }
  async recordOutcome(event: ConfirmedPaymentOutcome) {
    if (
      event.amountMinor !== BUSINESS.amountMinor ||
      event.currency !== BUSINESS.currency ||
      !['SUCCEEDED', 'FAILED'].includes(event.status) ||
      !/^[a-z][a-z0-9_-]{0,39}$/.test(event.provider) ||
      !/^[A-Za-z0-9._:-]{1,160}$/.test(event.providerPaymentId)
    )
      throw new BadRequestException();
    const [ref] = await this.db.client
      .select({ shopId: subscriptions.shopId })
      .from(paymentAttempts)
      .innerJoin(
        subscriptions,
        eq(subscriptions.id, paymentAttempts.subscriptionId),
      )
      .where(eq(paymentAttempts.id, event.attemptId));
    if (!ref) throw new NotFoundException();
    return this.withShop(ref.shopId, async (tx, shop, s) => {
      const [a] = await tx
        .select()
        .from(paymentAttempts)
        .where(
          and(
            eq(paymentAttempts.id, event.attemptId),
            eq(paymentAttempts.subscriptionId, s.id),
          ),
        )
        .for('update');
      if (!a) throw new NotFoundException();
      const [binding] = await tx
        .select()
        .from(paymentProviderBindings)
        .where(eq(paymentProviderBindings.attemptId, a.id));
      if (binding && binding.provider !== event.provider)
        throw new ConflictException();
      if (a.status !== 'PENDING') {
        if (
          a.provider === event.provider &&
          a.providerPaymentId === event.providerPaymentId &&
          a.status === event.status
        )
          return { duplicate: true, subscription: s };
        throw new ConflictException();
      }
      if (a.cycle !== s.cycle) throw new ConflictException();
      const now = this.clock.now();
      await tx
        .update(paymentAttempts)
        .set({
          provider: event.provider,
          providerPaymentId: event.providerPaymentId,
          status: event.status,
          completedAt: now,
        })
        .where(eq(paymentAttempts.id, a.id));
      let state: BillingState = s;
      if (event.status === 'SUCCEEDED') {
        state = activate(s, now);
        await tx.insert(subscriptionPayments).values({
          subscriptionId: s.id,
          attemptId: a.id,
          provider: event.provider,
          providerPaymentId: event.providerPaymentId,
          amountMinor: BUSINESS.amountMinor,
          currency: BUSINESS.currency,
          periodStart: state.periodStart!,
          periodEnd: state.periodEnd!,
          confirmedAt: now,
        });
      } else if (s.status === 'ACTIVE' && s.autoRenew && !s.cancelAtPeriodEnd) {
        state = {
          ...s,
          status: 'PAST_DUE',
          nextPaymentAt: new Date(now.getTime() + DAY),
          graceEndsAt: null,
        };
      }
      s = await this.save(
        tx,
        s,
        settlePeriod(state, now),
        event.status === 'SUCCEEDED'
          ? 'SUBSCRIPTION_PAYMENT_SUCCESS'
          : 'SUBSCRIPTION_PAYMENT_FAILED',
        'SYSTEM:billing',
        s.cycle + (event.status === 'SUCCEEDED' ? 1 : 0),
      );
      await syncShop(tx, shop, s, now);
      return { duplicate: false, subscription: s };
    });
  }
  reconcile(shopId: string) {
    return this.withShop(shopId, async (tx, shop, s) => {
      const now = this.clock.now(),
        state = settlePeriod(s, now);
      if (state.status !== s.status)
        s = await this.save(tx, s, state, 'SUBSCRIPTION_DEADLINE');
      await syncShop(tx, shop, s, now);
      return s;
    });
  }
  async tick() {
    // Keyset-free bounded due batch; no invented payment failures or automatic charges.
    const now = this.clock.now();
    const due = await this.db.client
      .select({ shopId: subscriptions.shopId })
      .from(subscriptions)
      .where(
        sql`(${subscriptions.status}='ACTIVE' AND ${subscriptions.periodEnd}<=${now} AND (NOT ${subscriptions.autoRenew} OR ${subscriptions.cancelAtPeriodEnd})) OR (${subscriptions.status}='GRACE' AND ${subscriptions.graceEndsAt}<=${now}) OR (${subscriptions.status}='PAST_DUE' AND ${subscriptions.nextPaymentAt}+interval '120 hours'<=${now})`,
      )
      .orderBy(subscriptions.id)
      .limit(100);
    for (const s of due) await this.reconcile(s.shopId);
    return { processed: due.length };
  }
}
