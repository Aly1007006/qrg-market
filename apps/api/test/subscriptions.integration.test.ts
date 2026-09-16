import 'reflect-metadata';
import { before, after, test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { createRequire } from 'node:module';
import { Test } from '@nestjs/testing';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { eq, inArray } from 'drizzle-orm';
import { AppModule } from '../src/app.module.js';
import { loadConfig } from '../src/config.js';
import { configureApplication } from '../src/http.js';
import { Database } from '../src/database.js';
import { runMigrations } from '../src/db/migrate.js';
import { AuthService } from '../src/auth/service.js';
import { ShopsService } from '../src/shops/service.js';
import {
  SubscriptionService,
  BillingClock,
} from '../src/subscriptions/service.js';
import {
  subscriptions,
  subscriptionPayments,
  paymentAttempts,
  shops,
  shopMembers,
  users,
  categories,
  products,
  productVariants,
  productImages,
} from '../src/db/schema.js';
import { DAY } from '../src/subscriptions/state.js';
import { syncModeratedShop } from '../src/subscriptions/visibility.js';
import { removeBillingFixtures } from './billing-fixtures.js';
const run = randomUUID(),
  emails = ['owner', 'other', 'employee'].map(
    (n) => run + '-' + n + '@example.test',
  );
const config = loadConfig({
  ...process.env,
  NODE_ENV: 'test',
  APP_ORIGIN: 'http://127.0.0.1:43188',
  AUTH_RATE_LIMIT_SECRET: run + '-subscription-test',
});
assert.ok(new URL(config.databaseUrl).pathname.endsWith('_test'));
let now = new Date(),
  app: NestExpressApplication,
  db: Database,
  service: SubscriptionService,
  base: string;
let owner: Awaited<ReturnType<AuthService['login']>>,
  other: typeof owner,
  employee: typeof owner;
let shopA: string, shopB: string, productId: string, categoryId: string;
const principal = () => app.get(AuthService).authenticate(owner.token);
const state = async () =>
  (
    await db.client
      .select()
      .from(subscriptions)
      .where(eq(subscriptions.shopId, shopA))
  )[0]!;
async function request(
  path: string,
  method = 'GET',
  body?: unknown,
  session = owner,
) {
  return fetch(base + '/api/v1/' + path, {
    method,
    headers: {
      origin: config.appOrigin,
      'x-qrg-client': 'web',
      'content-type': 'application/json',
      cookie: 'qrg_session=' + session.token,
      'x-qrg-csrf': session.csrfToken,
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}
const outcome = (attemptId: string, status: 'SUCCEEDED' | 'FAILED') => ({
  attemptId,
  status,
  provider: 'test_only',
  providerPaymentId: randomUUID(),
  amountMinor: 1000000,
  currency: 'KZT',
});
before(async () => {
  await runMigrations(config, resolve('drizzle'));
  const module = await Test.createTestingModule({
    imports: [AppModule.register(config)],
  })
    .overrideProvider(BillingClock)
    .useValue({ now: () => new Date(now) })
    .compile();
  app = module.createNestApplication<NestExpressApplication>({
    bodyParser: false,
    logger: false,
  });
  await configureApplication(app, config);
  await app.listen(0, '127.0.0.1');
  base = await app.getUrl();
  db = app.get(Database);
  service = app.get(SubscriptionService);
  const auth = app.get(AuthService),
    tenant = app.get(ShopsService),
    password = 'Billing integration only password 2026!';
  for (const email of emails) await auth.signup(email, password);
  owner = await auth.login(emails[0]!, password);
  other = await auth.login(emails[1]!, password);
  employee = await auth.login(emails[2]!, password);
  shopA = (await tenant.create(await principal(), 'Billing test ' + run)).id;
  shopB = (
    await tenant.create(
      await auth.authenticate(other.token),
      'Other billing ' + run,
    )
  ).id;
  await db.client.insert(shopMembers).values({
    shopId: shopA,
    userId: (await auth.authenticate(employee.token)).userId,
    role: 'SHOP_EMPLOYEE',
  });
  await db.client
    .update(shops)
    .set({ status: 'VERIFIED' })
    .where(eq(shops.id, shopA));
  const [c] = await db.client
    .insert(categories)
    .values({ name: 'Billing fixture', slug: 'billing-' + run })
    .returning();
  categoryId = c!.id;
  const [p] = await db.client
    .insert(products)
    .values({
      shopId: shopA,
      categoryId,
      name: 'Subscription product',
      slug: 'billing-product-' + run,
      basePrice: 1000,
      status: 'PUBLISHED',
    })
    .returning();
  productId = p!.id;
  await db.client
    .insert(productVariants)
    .values({ shopId: shopA, productId, available: true });
  await db.client.insert(productImages).values({
    productId,
    width: 100,
    height: 100,
    objectKey: 'products/' + productId + '/' + randomUUID() + '.webp',
    position: 0,
    alt: 'Fixture',
  });
});
after(async () => {
  if (db) {
    if (shopA && shopB) {
      await removeBillingFixtures(db, [shopA, shopB]);
      await db.client.delete(shops).where(inArray(shops.id, [shopA, shopB]));
    }
    await db.client.delete(users).where(inArray(users.email, emails));
    if (categoryId)
      await db.client.delete(categories).where(eq(categories.id, categoryId));
  }
  await app?.close();
});
void test('owner creates unpaid SUSPENDED subscription without trial; no provider or success endpoints', async () => {
  assert.equal(
    (await request('shops/' + shopA + '/subscription', 'POST', {})).status,
    200,
  );
  const s = await state();
  assert.equal(s.status, 'SUSPENDED');
  assert.equal(s.autoRenew, false);
  assert.equal(s.periodEnd, null);
  assert.equal(
    (await request('shops/' + shopA + '/subscription/renew', 'POST', {}))
      .status,
    503,
  );
  assert.equal(
    (
      await request(
        'subscriptions/callback',
        'POST',
        outcome(randomUUID(), 'SUCCEEDED'),
      )
    ).status,
    404,
  );
  assert.equal(
    (
      await db.client
        .select()
        .from(paymentAttempts)
        .where(eq(paymentAttempts.subscriptionId, s.id))
    ).length,
    0,
  );
});
void test('subscription endpoints enforce IDOR/BOLA, owner-only permission, CSRF and mass assignment', async () => {
  const path = 'shops/' + shopA + '/subscription';
  for (const suffix of ['', '/renew', '/cancel', '/disable-auto-renew']) {
    assert.equal(
      (
        await request(
          path + suffix,
          'POST',
          suffix.includes('cancel') || suffix.includes('disable')
            ? { expectedVersion: 0 }
            : {},
          other,
        )
      ).status,
      404,
    );
  }
  assert.equal((await request(path, 'GET', undefined, employee)).status, 403);
  assert.equal(
    (
      await request(path, 'POST', {
        status: 'ACTIVE',
        amountMinor: 1,
        shopId: shopB,
        autoRenew: true,
        role: 'ADMIN',
      })
    ).status,
    400,
  );
  assert.equal(
    (
      await request(
        path + '/cancel',
        'POST',
        { expectedVersion: 0 },
        { ...owner, csrfToken: 'wrong' },
      )
    ).status,
    403,
  );
});
void test('activation validates amount/currency and creates exactly one receipt and visible verified shop', async () => {
  const a = await service.beginAttempt(shopA, 'INITIAL', randomUUID());
  const event = outcome(a.id, 'SUCCEEDED');
  await assert.rejects(service.recordOutcome({ ...event, amountMinor: 1 }));
  await assert.rejects(service.recordOutcome({ ...event, currency: 'USD' }));
  assert.equal((await state()).status, 'SUSPENDED');
  const results = await Promise.all([
    service.recordOutcome(event),
    service.recordOutcome(event),
  ]);
  assert.equal(results.filter((r) => r.duplicate).length, 1);
  const s = await state();
  assert.equal(s.status, 'ACTIVE');
  assert.equal(s.cycle, 1);
  assert.equal(
    (
      await db.client
        .select()
        .from(subscriptionPayments)
        .where(eq(subscriptionPayments.subscriptionId, s.id))
    ).length,
    1,
  );
  assert.equal(
    (await request('public/products/billing-product-' + run)).status,
    200,
  );
  await assert.rejects(service.recordOutcome({ ...event, status: 'FAILED' }));
});
void test('renewal uses original period boundary and cannot charge early or twice concurrently', async () => {
  // Models a future explicitly consented recurring mandate, only in this fixture.
  await db.client
    .update(subscriptions)
    .set({ autoRenew: true, nextPaymentAt: (await state()).periodEnd })
    .where(eq(subscriptions.shopId, shopA));
  await assert.rejects(service.beginAttempt(shopA, 'RENEWAL', randomUUID()));
  now = (await state()).periodEnd!;
  const key = randomUUID();
  const [a, duplicate] = await Promise.all([
    service.beginAttempt(shopA, 'RENEWAL', key),
    service.beginAttempt(shopA, 'RENEWAL', key),
  ]);
  assert.equal(a.id, duplicate.id);
  await assert.rejects(service.beginAttempt(shopA, 'RENEWAL', randomUUID()));
  await service.recordOutcome(outcome(a.id, 'SUCCEEDED'));
  const s = await state();
  assert.equal(s.periodStart!.getTime(), now.getTime());
  assert.equal(s.nextPaymentAt!.getTime(), s.periodEnd!.getTime());
});
void test('failed recurring → PAST_DUE → scheduled retry → GRACE, duplicates never reset deadlines', async () => {
  now = (await state()).periodEnd!;
  const a = await service.beginAttempt(shopA, 'RENEWAL', randomUUID());
  await service.recordOutcome(outcome(a.id, 'FAILED'));
  let s = await state();
  assert.equal(s.status, 'PAST_DUE');
  assert.equal(s.nextPaymentAt!.getTime(), now.getTime() + DAY);
  await assert.rejects(service.beginAttempt(shopA, 'RETRY', randomUUID()));
  now = s.nextPaymentAt!;
  const retry = await service.beginAttempt(shopA, 'RETRY', randomUUID());
  const event = outcome(retry.id, 'FAILED');
  await service.recordOutcome(event);
  s = await state();
  assert.equal(s.status, 'GRACE');
  assert.equal(s.graceEndsAt!.getTime(), now.getTime() + 5 * DAY);
  await service.recordOutcome(event);
  assert.equal(
    (await state()).graceEndsAt!.getTime(),
    s.graceEndsAt!.getTime(),
  );
});
void test('five-day suspension preserves shop, products, variants and images and seller access', async () => {
  const end = (await state()).graceEndsAt!;
  now = new Date(end.getTime() - 1);
  assert.equal((await service.reconcile(shopA)).status, 'GRACE');
  now = end;
  assert.equal((await service.reconcile(shopA)).status, 'SUSPENDED');
  assert.equal(
    (await request('public/products/billing-product-' + run)).status,
    404,
  );
  assert.equal((await request('shops/' + shopA + '/products')).status, 200);
  assert.equal((await request('shops/' + shopA + '/subscription')).status, 200);
  assert.equal(
    (await request('shops/' + shopA + '/subscription/renew', 'POST', {}))
      .status,
    503,
  );
  assert.equal(
    (
      await db.client
        .select()
        .from(productImages)
        .where(eq(productImages.productId, productId))
    ).length,
    1,
  );
  assert.equal(
    (
      await db.client
        .select()
        .from(productVariants)
        .where(eq(productVariants.productId, productId))
    ).length,
    1,
  );
});
void test('successful reactivation restores verified storefront but never administrative SUSPENDED', async () => {
  const a = await service.beginAttempt(shopA, 'RENEWAL', randomUUID());
  await service.recordOutcome(outcome(a.id, 'SUCCEEDED'));
  assert.equal((await state()).status, 'ACTIVE');
  assert.equal(
    (await request('public/products/billing-product-' + run)).status,
    200,
  );
  now = (await state()).periodEnd!;
  await db.client
    .update(shops)
    .set({ status: 'SUSPENDED' })
    .where(eq(shops.id, shopA));
  const b = await service.beginAttempt(shopA, 'RENEWAL', randomUUID());
  await service.recordOutcome(outcome(b.id, 'SUCCEEDED'));
  assert.equal(
    (await request('public/products/billing-product-' + run)).status,
    404,
  );
  assert.equal(
    (await db.client.select().from(shops).where(eq(shops.id, shopA)))[0]!
      .status,
    'SUSPENDED',
  );
});
void test('cancellation/disable auto-renew are versioned; concurrent changes have one winner', async () => {
  const s = await state();
  const results = await Promise.all([
    request('shops/' + shopA + '/subscription/cancel', 'POST', {
      expectedVersion: s.version,
    }),
    request('shops/' + shopA + '/subscription/disable-auto-renew', 'POST', {
      expectedVersion: s.version,
    }),
  ]);
  assert.deepEqual(results.map((r) => r.status).sort(), [200, 409]);
  let updated = await state();
  if (!updated.cancelAtPeriodEnd)
    updated = await service.disableRenewal(
      await principal(),
      shopA,
      updated.version,
      true,
    );
  assert.equal(updated.status, 'ACTIVE');
  assert.equal(updated.autoRenew, false);
  assert.equal(updated.nextPaymentAt, null);
  now = new Date(updated.periodEnd!.getTime() - 1);
  assert.equal((await service.reconcile(shopA)).status, 'ACTIVE');
  now = updated.periodEnd!;
  assert.equal((await service.reconcile(shopA)).status, 'CANCELLED');
});
void test('global payment identity cannot be reused for another attempt; failed writes roll back', async () => {
  const [receipt] = await db.client
    .select()
    .from(subscriptionPayments)
    .where(eq(subscriptionPayments.subscriptionId, (await state()).id));
  assert.ok(receipt);
  const a = await service.beginAttempt(shopA, 'RENEWAL', randomUUID());
  await assert.rejects(
    service.recordOutcome({
      ...outcome(a.id, 'SUCCEEDED'),
      providerPaymentId: receipt.providerPaymentId,
    }),
  );
  assert.equal(
    (
      await db.client
        .select()
        .from(paymentAttempts)
        .where(eq(paymentAttempts.id, a.id))
    )[0]!.status,
    'PENDING',
  );
  assert.equal((await state()).status, 'CANCELLED');
  await service.recordOutcome(outcome(a.id, 'SUCCEEDED'));
  assert.equal((await state()).autoRenew, false);
});
void test('database rejects invalid plan, orphan payment and malformed period', async () => {
  await assert.rejects(
    db.client
      .update(subscriptions)
      .set({ amountMinor: 1 })
      .where(eq(subscriptions.shopId, shopA)),
  );
  await assert.rejects(
    db.client
      .update(subscriptions)
      .set({ periodEnd: (await state()).periodStart })
      .where(eq(subscriptions.shopId, shopA)),
  );
  await assert.rejects(
    db.client.insert(subscriptionPayments).values({
      subscriptionId: (await state()).id,
      attemptId: randomUUID(),
      provider: 'test_only',
      providerPaymentId: randomUUID(),
      amountMinor: 1000000,
      currency: 'KZT',
      periodStart: now,
      periodEnd: new Date(now.getTime() + DAY),
      confirmedAt: now,
    }),
  );
});
void test('expired grace is hidden immediately even before maintenance; tick is repeatable', async () => {
  const end = new Date(Date.now() - 1000);
  await db.client
    .update(subscriptions)
    .set({ status: 'GRACE', graceEndsAt: end, nextPaymentAt: null })
    .where(eq(subscriptions.shopId, shopA));
  await db.client
    .update(shops)
    .set({ status: 'ACTIVE' })
    .where(eq(shops.id, shopA));
  assert.equal(
    (await request('public/products/billing-product-' + run)).status,
    404,
  );
  now = end;
  await service.tick();
  await service.tick();
  assert.equal((await state()).status, 'SUSPENDED');
});
void test('PAST_DUE and GRACE renew successfully; payment before moderation cannot publish a draft', async () => {
  const p = await app.get(AuthService).authenticate(other.token);
  await service.create(p, shopB);
  const get = async () =>
    (
      await db.client
        .select()
        .from(subscriptions)
        .where(eq(subscriptions.shopId, shopB))
    )[0]!;
  const initial = await service.beginAttempt(shopB, 'INITIAL', randomUUID());
  await service.recordOutcome(outcome(initial.id, 'FAILED'));
  assert.equal((await get()).status, 'SUSPENDED');
  const second = await service.beginAttempt(shopB, 'INITIAL', randomUUID());
  await service.recordOutcome(outcome(second.id, 'SUCCEEDED'));
  assert.equal(
    (await db.client.select().from(shops).where(eq(shops.id, shopB)))[0]!
      .status,
    'DRAFT',
  );
  // Same locked helper used by the admin APPROVE transaction.
  await db.client.transaction(async (tx) => {
    const [shop] = await tx
      .select()
      .from(shops)
      .where(eq(shops.id, shopB))
      .for('update');
    assert.ok(shop);
    await tx
      .update(shops)
      .set({ status: 'VERIFIED' })
      .where(eq(shops.id, shopB));
    assert.equal(
      await syncModeratedShop(tx, { ...shop, status: 'VERIFIED' }),
      'ACTIVE',
    );
  });
  for (const target of ['PAST_DUE', 'GRACE'] as const) {
    const s = await get();
    now = s.periodEnd!;
    await db.client
      .update(subscriptions)
      .set({ autoRenew: true, nextPaymentAt: s.periodEnd })
      .where(eq(subscriptions.shopId, shopB));
    const failed = await service.beginAttempt(shopB, 'RENEWAL', randomUUID());
    await service.recordOutcome(outcome(failed.id, 'FAILED'));
    let successful;
    if (target === 'GRACE') {
      now = (await get()).nextPaymentAt!;
      successful = await service.beginAttempt(shopB, 'RETRY', randomUUID());
    } else
      successful = await service.beginAttempt(shopB, 'RENEWAL', randomUUID());
    assert.equal((await get()).status, target);
    await service.recordOutcome(outcome(successful.id, 'SUCCEEDED'));
    assert.equal((await get()).status, 'ACTIVE');
    assert.equal((await get()).graceEndsAt, null);
  }
  const s = await get();
  const disabled = await service.disableRenewal(p, shopB, s.version, false);
  assert.equal(disabled.status, 'ACTIVE');
  assert.equal(disabled.nextPaymentAt, null);
  now = disabled.periodEnd!;
  assert.equal((await service.reconcile(shopB)).status, 'SUSPENDED');
});
if (process.env.QRG_TEST_BUILT_SUBSCRIPTIONS === 'true')
  void test('built seller subscription page/BFF show true provider state and preserve authorization', async () => {
    const requireWeb = createRequire(resolve('../web/package.json'));
    const child = spawn(
      process.execPath,
      [
        requireWeb.resolve('next/dist/bin/next'),
        'start',
        '-p',
        '43188',
        '-H',
        '127.0.0.1',
      ],
      {
        cwd: resolve('../web'),
        stdio: 'pipe',
        env: {
          ...process.env,
          NODE_ENV: 'production',
          QRG_API_ORIGIN: base,
          QRG_APP_ORIGIN: config.appOrigin,
          QRG_DEV_FIXTURES: 'false',
        },
      },
    );
    child.stdout.on('data', () => {});
    child.stderr.on('data', () => {});
    try {
      let ready = false;
      for (let i = 0; i < 100; i++) {
        try {
          ready = (await fetch(config.appOrigin + '/seller/login')).ok;
          if (ready) break;
        } catch {
          /* Bounded local server startup retry. */
        }
        await new Promise((r) => setTimeout(r, 100));
      }
      assert.ok(ready);
      const r = await fetch(
        config.appOrigin + '/seller/' + shopA + '/subscription',
        { headers: { cookie: 'qrg_session=' + owner.token } },
      );
      assert.equal(r.status, 200);
      const html = await r.text();
      assert.ok(html.includes('QRG BUSINESS'));
      assert.ok(html.includes('Онлайн-оплата пока не подключена'));
      assert.ok(html.includes('История попыток оплаты'));
      assert.ok(html.includes('Приостановлена'));
      const renewal = await fetch(
        config.appOrigin + '/api/seller/shops/' + shopA + '/subscription/renew',
        {
          method: 'POST',
          headers: {
            cookie: 'qrg_session=' + owner.token,
            origin: config.appOrigin,
            'content-type': 'application/json',
            'x-qrg-client': 'web',
            'x-qrg-csrf': owner.csrfToken,
          },
          body: '{}',
        },
      );
      assert.equal(renewal.status, 503);
      assert.equal(
        (
          await fetch(config.appOrigin + '/seller/' + shopA + '/subscription', {
            headers: { cookie: 'qrg_session=' + other.token },
          })
        ).status,
        404,
      );
    } finally {
      if (child.exitCode === null) {
        const exited = once(child, 'exit');
        child.kill();
        await exited;
      }
    }
  });
