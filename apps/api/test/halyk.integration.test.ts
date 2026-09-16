import 'reflect-metadata';
import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import { Test } from '@nestjs/testing';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { eq, inArray, sql } from 'drizzle-orm';
import { AppModule } from '../src/app.module.js';
import { loadConfig } from '../src/config.js';
import { configureApplication } from '../src/http.js';
import { Database } from '../src/database.js';
import { runMigrations } from '../src/db/migrate.js';
import { AuthService } from '../src/auth/service.js';
import { ShopsService } from '../src/shops/service.js';
import {
  BillingClock,
  SubscriptionService,
} from '../src/subscriptions/service.js';
import { HalykPaymentProvider } from '../src/subscriptions/halyk/provider.js';
import { PaymentInvoiceBindings } from '../src/subscriptions/invoice-bindings.js';
import {
  PaymentProvider,
  type PaymentReference,
} from '../src/subscriptions/provider.js';
import { DAY } from '../src/subscriptions/state.js';
import {
  paymentAttempts,
  paymentProviderBindings,
  shops,
  subscriptionPayments,
  subscriptions,
  users,
} from '../src/db/schema.js';
import { removeBillingFixtures } from './billing-fixtures.js';

// This suite composes an OFFLINE status fixture with the PHASE 7 ledger in _test.
// It does not simulate a valid Halyk signature, enable a production callback or
// claim that actual bank debits/merchant settings have been acceptance-tested.
const run = randomUUID();
const emails = [run + '-halyk-a@example.test', run + '-halyk-b@example.test'];
const config = loadConfig({
  ...process.env,
  NODE_ENV: 'test',
  APP_ORIGIN: 'http://localhost:3000',
  AUTH_RATE_LIMIT_SECRET: run + '-halyk-test',
});
assert.ok(new URL(config.databaseUrl).pathname.endsWith('_test'));
const terminalId = randomUUID();
const observations = new Map<string, Record<string, unknown>>();
const provider = new HalykPaymentProvider(
  {
    environment: 'sandbox',
    terminalId,
    clientId: 'offline-fixture',
    clientSecret: 'not-a-bank-credential',
  },
  (url) => {
    const body = url.endsWith('/oauth2/token')
      ? {
          access_token: 'offline-token',
          expires_in: 7200,
          token_type: 'Bearer',
        }
      : {
          resultCode: '100',
          transaction: observations.get(url.split('/').at(-1)!),
        };
    return Promise.resolve(
      new Response(JSON.stringify(body), {
        headers: { 'content-type': 'application/json' },
      }),
    );
  },
);
let app: NestExpressApplication,
  db: Database,
  service: SubscriptionService,
  bindings: PaymentInvoiceBindings,
  base: string;
let owner: Awaited<ReturnType<AuthService['login']>>, other: typeof owner;
let shopA: string,
  shopB: string,
  now = new Date();
function begin(
  shopId: string,
  kind: 'INITIAL' | 'RENEWAL' | 'RETRY',
  key: string = randomUUID(),
) {
  return service.beginAttempt(shopId, kind, key, (tx, attempt) =>
    bindings.bind(tx, attempt),
  );
}
const principal = () => app.get(AuthService).authenticate(owner.token);
const state = async (shopId = shopA) =>
  (
    await db.client
      .select()
      .from(subscriptions)
      .where(eq(subscriptions.shopId, shopId))
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
async function observe(
  attempt: typeof paymentAttempts.$inferSelect,
  statusName = 'CHARGE',
  id: string = randomUUID(),
): Promise<PaymentReference> {
  const reference = await bindings.reference(attempt.id, id);
  observations.set(reference.invoiceId, {
    id,
    invoiceID: reference.invoiceId,
    terminalID: terminalId,
    accountID: reference.subscriptionId,
    amount: 10000,
    currency: 'KZT',
    statusName,
    createdDate: now.toISOString(),
  });
  return reference;
}
async function recordFixture(reference: PaymentReference) {
  const observation = await bindings.inspect(
    reference.attemptId,
    reference.providerPaymentId,
  );
  assert.ok(
    observation.state === 'SUCCEEDED' || observation.state === 'FAILED',
  );
  // Deliberate TEST-ONLY bridge. No production caller bypasses verifyCallback.
  return service.recordOutcome({
    attemptId: reference.attemptId,
    provider: 'halyk',
    providerPaymentId: reference.providerPaymentId,
    amountMinor: observation.amountMinor,
    currency: observation.currency,
    status: observation.state,
  });
}
before(async () => {
  await runMigrations(config, resolve('drizzle'));
  const module = await Test.createTestingModule({
    imports: [AppModule.register(config)],
  })
    .overrideProvider(BillingClock)
    .useValue({ now: () => new Date(now) })
    .overrideProvider(PaymentProvider)
    .useValue(provider)
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
  bindings = app.get(PaymentInvoiceBindings);
  const auth = app.get(AuthService),
    tenant = app.get(ShopsService),
    password = 'Offline Halyk test password only 2026!';
  for (const email of emails) await auth.signup(email, password);
  owner = await auth.login(emails[0]!, password);
  other = await auth.login(emails[1]!, password);
  shopA = (await tenant.create(await principal(), 'Halyk A ' + run)).id;
  shopB = (
    await tenant.create(await auth.authenticate(other.token), 'Halyk B ' + run)
  ).id;
  await db.client
    .update(shops)
    .set({ status: 'VERIFIED' })
    .where(inArray(shops.id, [shopA, shopB]));
  await service.create(await principal(), shopA);
  await service.create(await auth.authenticate(other.token), shopB);
});
after(async () => {
  if (db && shopA && shopB) {
    await removeBillingFixtures(db, [shopA, shopB]);
    await db.client.delete(shops).where(inArray(shops.id, [shopA, shopB]));
  }
  if (db) await db.client.delete(users).where(inArray(users.email, emails));
  await app?.close();
});

void test('fake success redirect, forged callbacks, frontend amount and BOLA cannot activate or start a charge', async () => {
  const beforeState = await state();
  const path = 'shops/' + shopA + '/subscription';
  assert.equal((await request(path + '/renew', 'POST', {})).status, 503);
  assert.equal(
    (
      await request(path + '/renew', 'POST', {
        amount: 1,
        currency: 'USD',
        subscriptionId: (await state(shopB)).id,
      })
    ).status,
    400,
  );
  assert.equal((await request(path + '/renew', 'POST', {}, other)).status, 404);
  for (const suffix of ['/success?success=true', '/callback']) {
    assert.equal(
      (
        await request(
          path + suffix,
          suffix.includes('?') ? 'GET' : 'POST',
          suffix.includes('?')
            ? undefined
            : { code: 'ok', signature: 'forged' },
        )
      ).status,
      404,
    );
  }
  assert.equal((await request(path + '?success=true')).status, 400);
  assert.deepEqual(await state(), beforeState);
  assert.equal(
    (
      await db.client
        .select()
        .from(paymentAttempts)
        .where(eq(paymentAttempts.subscriptionId, beforeState.id))
    ).length,
    0,
  );
});

void test('first-payment status fixture: wrong amount/currency/merchant/subscription rejected; duplicate/replay gives one receipt and period', async () => {
  const attempt = await begin(shopA, 'INITIAL');
  const ref = await observe(attempt),
    original = observations.get(ref.invoiceId)!;
  const beforeState = await state();
  for (const mutation of [
    { amount: 1 },
    { currency: 'USD' },
    { accountID: (await state(shopB)).id },
    { terminalID: randomUUID() },
    { id: randomUUID() },
  ]) {
    observations.set(ref.invoiceId, { ...original, ...mutation });
    await assert.rejects(recordFixture(ref));
    assert.deepEqual(await state(), beforeState);
  }
  observations.set(ref.invoiceId, original);
  await assert.rejects(
    service.recordOutcome({
      attemptId: attempt.id,
      provider: 'wrong_provider',
      providerPaymentId: ref.providerPaymentId,
      amountMinor: 1000000,
      currency: 'KZT',
      status: 'SUCCEEDED',
    }),
  );
  await assert.rejects(
    provider.getPaymentStatus({
      ...ref,
      subscriptionId: (await state(shopB)).id,
    }),
  );
  const outcomes = await Promise.all([recordFixture(ref), recordFixture(ref)]);
  assert.deepEqual(outcomes.map((x) => x.duplicate).sort(), [false, true]);
  const paid = await state();
  assert.equal(paid.status, 'ACTIVE');
  assert.equal(paid.cycle, 1);
  assert.equal((await recordFixture(ref)).duplicate, true);
  assert.deepEqual(await state(), paid);
  assert.equal(
    (
      await db.client
        .select()
        .from(subscriptionPayments)
        .where(eq(subscriptionPayments.subscriptionId, paid.id))
    ).length,
    1,
  );
});

void test('reusing a provider payment ID for a different subscription rolls back the entire ledger transaction', async () => {
  const receipt = (
    await db.client
      .select()
      .from(subscriptionPayments)
      .where(eq(subscriptionPayments.subscriptionId, (await state()).id))
  )[0]!;
  const attempt = await begin(shopB, 'INITIAL');
  const ref = await observe(attempt, 'CHARGE', receipt.providerPaymentId);
  const beforeState = await state(shopB);
  await assert.rejects(recordFixture(ref));
  assert.deepEqual(await state(shopB), beforeState);
  const persisted = (
    await db.client
      .select()
      .from(paymentAttempts)
      .where(eq(paymentAttempts.id, attempt.id))
  )[0]!;
  assert.equal(persisted.status, 'PENDING');
  assert.equal(persisted.providerPaymentId, null);
});

void test('recurring status fixtures: CHARGE renews; definitive FAILED enters PAST_DUE; AUTH does not settle', async () => {
  // Consent/mandate creation is not implemented: only a fixture changes this flag.
  await db.client
    .update(subscriptions)
    .set({ autoRenew: true })
    .where(eq(subscriptions.shopId, shopA));
  now = (await state()).periodEnd!;
  const renewal = await begin(shopA, 'RENEWAL');
  const ref = await observe(renewal, 'AUTH');
  assert.equal((await provider.getPaymentStatus(ref)).state, 'PENDING');
  await assert.rejects(recordFixture(ref));
  observations.get(ref.invoiceId)!.statusName = 'CHARGE';
  await recordFixture(ref);
  assert.equal((await state()).status, 'ACTIVE');
  assert.equal((await state()).cycle, 2);
  now = (await state()).periodEnd!;
  const failed = await observe(await begin(shopA, 'RENEWAL'), 'FAILED');
  await recordFixture(failed);
  const pastDue = await state();
  assert.equal(pastDue.status, 'PAST_DUE');
  assert.equal(pastDue.nextPaymentAt?.getTime(), now.getTime() + DAY);
  assert.equal((await recordFixture(failed)).duplicate, true);
  assert.deepEqual(await state(), pastDue);
});

void test('delayed status after grace suspension reactivates once, without replay or state loss', async () => {
  now = (await state()).nextPaymentAt!;
  const retry = await begin(shopA, 'RETRY');
  const ref = await observe(retry);
  now = new Date((await state()).graceEndsAt!.getTime() + DAY);
  await service.reconcile(shopA);
  assert.equal((await state()).status, 'SUSPENDED');
  await recordFixture(ref);
  const active = await state();
  assert.equal(active.status, 'ACTIVE');
  assert.equal(active.periodStart?.getTime(), now.getTime());
  assert.equal((await recordFixture(ref)).duplicate, true);
  assert.deepEqual(await state(), active);
});

void test('invoice bindings reserve atomically and concurrent retry of one key reuses one immutable invoice', async () => {
  now = (await state()).periodEnd!;
  const key = randomUUID();
  const [first, second] = await Promise.all([
    begin(shopA, 'RENEWAL', key),
    begin(shopA, 'RENEWAL', key),
  ]);
  assert.equal(first.id, second.id);
  const rows = await db.client
    .select()
    .from(paymentProviderBindings)
    .where(eq(paymentProviderBindings.attemptId, first.id));
  assert.equal(rows.length, 1);
  assert.match(rows[0]!.invoiceId, /^[1-9][0-9]{5}$/);
  assert.equal(rows[0]!.subscriptionId, first.subscriptionId);
  assert.equal(rows[0]!.merchantId, terminalId);
  await assert.rejects(
    db.client
      .update(paymentProviderBindings)
      .set({ invoiceId: '999999' })
      .where(eq(paymentProviderBindings.attemptId, first.id)),
  );
  await assert.rejects(
    db.client
      .update(paymentProviderBindings)
      .set({ subscriptionId: (await state(shopB)).id })
      .where(eq(paymentProviderBindings.attemptId, first.id)),
  );
  await assert.rejects(service.beginAttempt(shopB, 'INITIAL', key));
  const ref = await observe(first);
  assert.deepEqual(
    await bindings.referenceForInvoice(ref.invoiceId, ref.providerPaymentId),
    ref,
  );
  await assert.rejects(
    bindings.referenceForInvoice('1' + ref.invoiceId, ref.providerPaymentId),
  );
  const foreignProvider = new HalykPaymentProvider({
    environment: 'sandbox',
    terminalId: randomUUID(),
    clientId: 'offline',
    clientSecret: 'offline-only',
  });
  const foreign = new PaymentInvoiceBindings(db, foreignProvider);
  await assert.rejects(foreign.reference(first.id, ref.providerPaymentId));
  await assert.rejects(
    service.beginAttempt(shopA, 'RENEWAL', key, (tx, attempt) =>
      foreign.bind(tx, attempt),
    ),
  );
  const prodProvider = new HalykPaymentProvider({
    environment: 'production',
    terminalId,
    clientId: 'offline',
    clientSecret: 'offline-only',
  });
  await assert.rejects(
    new PaymentInvoiceBindings(db, prodProvider).reference(
      first.id,
      ref.providerPaymentId,
    ),
  );
  await recordFixture(ref);
  await assert.rejects(bindings.reference(first.id, randomUUID()));
});

void test('binding failure rolls back a new attempt, and invoice sequence never reuses consumed numbers', async () => {
  now = (await state()).periodEnd!;
  const key = randomUUID();
  let consumed = 0;
  await assert.rejects(
    service.beginAttempt(shopA, 'RENEWAL', key, async (tx, attempt) => {
      await bindings.bind(tx, attempt);
      const [binding] = await tx
        .select()
        .from(paymentProviderBindings)
        .where(eq(paymentProviderBindings.attemptId, attempt.id));
      consumed = Number(binding!.invoiceId);
      throw new Error('Synthetic crash before transaction commit');
    }),
  );
  assert.equal(
    (
      await db.client
        .select()
        .from(paymentAttempts)
        .where(eq(paymentAttempts.idempotencyKey, key))
    ).length,
    0,
  );
  const retry = await begin(shopA, 'RENEWAL', key);
  const ref = await observe(retry);
  assert.ok(Number(ref.invoiceId) > consumed);
  const sequence = await db.client.execute<{
    min_value: string;
    max_value: string;
    cycle: boolean;
  }>(
    sql`SELECT min_value::text, max_value::text, cycle FROM pg_sequences WHERE schemaname='public' AND sequencename='halyk_invoice_sequence'`,
  );
  assert.deepEqual(sequence.rows[0], {
    min_value: '100000',
    max_value: '999999',
    cycle: false,
  });
  await assert.rejects(bindings.reference(randomUUID(), randomUUID()));
  await recordFixture(ref);
});

void test('database prevents duplicate invoices and cross-subscription/orphan bindings', async () => {
  now = (await state()).periodEnd!;
  const existing = (
    await db.client
      .select()
      .from(paymentProviderBindings)
      .where(eq(paymentProviderBindings.subscriptionId, (await state()).id))
  )[0]!;
  const attempt = await service.beginAttempt(shopA, 'RENEWAL', randomUUID());
  const data = {
    attemptId: attempt.id,
    subscriptionId: attempt.subscriptionId,
    provider: 'halyk' as const,
    environment: 'sandbox' as const,
    merchantId: terminalId,
    invoiceId: existing.invoiceId,
  };
  await assert.rejects(db.client.insert(paymentProviderBindings).values(data));
  await assert.rejects(
    db.client.insert(paymentProviderBindings).values({
      ...data,
      subscriptionId: (await state(shopB)).id,
      invoiceId: '000001',
    }),
  );
  await assert.rejects(
    db.client.insert(paymentProviderBindings).values({
      ...data,
      subscriptionId: (await state(shopB)).id,
      invoiceId: '999998',
    }),
  );
  await assert.rejects(
    db.client
      .insert(paymentProviderBindings)
      .values({ ...data, attemptId: randomUUID(), invoiceId: '999998' }),
  );
  assert.equal(
    (
      await db.client
        .select()
        .from(paymentProviderBindings)
        .where(eq(paymentProviderBindings.attemptId, attempt.id))
    ).length,
    0,
  );
});
