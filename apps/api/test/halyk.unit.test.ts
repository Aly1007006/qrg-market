import 'reflect-metadata';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { randomUUID } from 'node:crypto';
import { ServiceUnavailableException } from '@nestjs/common';
import {
  HALYK_ENDPOINTS,
  loadHalykConfig,
  type HalykConfig,
} from '../src/subscriptions/halyk/config.js';
import { HalykPaymentProvider } from '../src/subscriptions/halyk/provider.js';
import { createPaymentProvider } from '../src/subscriptions/provider-factory.js';
import {
  UnconfiguredPaymentProvider,
  type PaymentReference,
} from '../src/subscriptions/provider.js';
import type { HalykTransport } from '../src/subscriptions/halyk/client.js';

// Synthetic HTTP fixtures, not Halyk-issued credentials or a production provider.
const config: HalykConfig = Object.freeze({
  environment: 'sandbox',
  terminalId: randomUUID(),
  clientId: 'qrg-contract-test',
  clientSecret: 'offline-test-only-client-secret',
});
const reference: PaymentReference = Object.freeze({
  attemptId: randomUUID(),
  subscriptionId: randomUUID(),
  invoiceId: '123456',
  providerPaymentId: randomUUID(),
});
const token = {
  access_token: 'offline-token-never-a-bank-token',
  token_type: 'Bearer',
  expires_in: 7200,
};
const json = (body: unknown) =>
  new Response(JSON.stringify(body), {
    headers: { 'content-type': 'application/json' },
  });
function transaction(overrides: Record<string, unknown> = {}) {
  return {
    id: reference.providerPaymentId,
    invoiceID: reference.invoiceId,
    terminalID: config.terminalId,
    accountID: reference.subscriptionId,
    amount: 10000,
    currency: 'KZT',
    statusName: 'CHARGE',
    amountBonus: 0,
    ...overrides,
  };
}
function provider(
  body: unknown,
  calls: { url: string; init: RequestInit }[] = [],
) {
  return new HalykPaymentProvider(config, (url, init) => {
    calls.push({ url, init });
    return Promise.resolve(
      json(url === HALYK_ENDPOINTS.sandbox.oauth ? token : body),
    );
  });
}
const unavailable = (error: unknown) =>
  error instanceof ServiceUnavailableException;

void test('Halyk config is opt-in, complete, and cannot use shared test credentials/sandbox in production', () => {
  assert.equal(loadHalykConfig({}), undefined);
  assert.ok(createPaymentProvider({}) instanceof UnconfiguredPaymentProvider);
  const env = {
    HALYK_ENVIRONMENT: 'sandbox',
    HALYK_CLIENT_ID: config.clientId,
    HALYK_CLIENT_SECRET: config.clientSecret,
    HALYK_TERMINAL_ID: config.terminalId,
  };
  assert.deepEqual(loadHalykConfig(env), config);
  assert.ok(createPaymentProvider(env) instanceof HalykPaymentProvider);
  for (const bad of [
    { HALYK_ENVIRONMENT: 'test' },
    { HALYK_TERMINAL_ID: '' },
    { HALYK_CLIENT_ID: '' },
    { HALYK_CLIENT_SECRET: '' },
    { HALYK_CLIENT_ID: 'injected\r\nvalue' },
    { HALYK_CLIENT_SECRET: 'secret\nvalue' },
    { NODE_ENV: 'production' },
    { HALYK_ENVIRONMENT: 'production', HALYK_CLIENT_ID: 'test' },
  ])
    assert.throws(() => loadHalykConfig({ ...env, ...bad }));
});

void test('credentials alone never enable checkout or recurring; no request is sent', async () => {
  const calls: { url: string; init: RequestInit }[] = [];
  const p = provider({}, calls);
  assert.equal(p.available(), false);
  await assert.rejects(p.createInitialPayment(), unavailable);
  await assert.rejects(p.chargeRecurring(), unavailable);
  assert.equal(calls.length, 0);
});

void test('invalid/absent/invented callback signature and echoed secret all fail closed, including replay', async () => {
  const calls: { url: string; init: RequestInit }[] = [];
  const p = provider({}, calls);
  // No invented Halyk signature scheme: even convincing success JSON is rejected.
  const notification = {
    ...transaction(),
    code: 'ok',
    secret_hash: 'synthetic-echo-secret',
    signature: 'attacker-value',
  };
  for (const body of [
    null,
    {},
    notification,
    notification,
    { success: true },
    { ...notification, signature: undefined },
  ])
    await assert.rejects(p.verifyCallback(body), unavailable);
  assert.equal(calls.length, 0);
});

void test('status contract uses fixed HTTPS endpoints, multipart OAuth, terminal and backend amount, without passing secrets to GET', async () => {
  const calls: { url: string; init: RequestInit }[] = [];
  const result = await provider(
    { resultCode: '100', transaction: transaction() },
    calls,
  ).getPaymentStatus(reference);
  assert.equal(calls.length, 2);
  assert.equal(
    calls[0]!.url,
    'https://test-epay-oauth.epayment.kz/oauth2/token',
  );
  const body = calls[0]!.init.body;
  assert.ok(body instanceof FormData);
  assert.deepEqual([...body.keys()].sort(), [
    'client_id',
    'client_secret',
    'grant_type',
    'scope',
    'terminal',
  ]);
  assert.equal(body.get('terminal'), config.terminalId);
  assert.equal(body.get('client_secret'), config.clientSecret);
  assert.equal(body.get('grant_type'), 'client_credentials');
  assert.equal(
    calls[1]!.url,
    'https://test-epay-api.epayment.kz/check-status/payment/transaction/123456',
  );
  assert.equal(calls[1]!.init.method, 'GET');
  assert.equal(calls[1]!.init.body, undefined);
  assert.equal(
    new Headers(calls[1]!.init.headers).get('authorization'),
    'Bearer ' + token.access_token,
  );
  for (const call of calls) {
    assert.equal(call.init.redirect, 'error');
    assert.equal(call.init.cache, 'no-store');
    assert.equal(call.init.credentials, 'omit');
  }
  assert.deepEqual(result, {
    provider: 'halyk',
    reference,
    state: 'SUCCEEDED',
    amountMinor: 1000000,
    currency: 'KZT',
  });
});

void test('production selects only official production endpoints; test performs no actual network call', async () => {
  const urls: string[] = [];
  const p = new HalykPaymentProvider(
    { ...config, environment: 'production' },
    (url) => {
      urls.push(url);
      return Promise.resolve(
        json(
          url.endsWith('/oauth2/token')
            ? token
            : { resultCode: '100', transaction: transaction() },
        ),
      );
    },
  );
  await p.getPaymentStatus(reference);
  assert.deepEqual(urls, [
    'https://epay-oauth.homebank.kz/oauth2/token',
    'https://epay-api.homebank.kz/check-status/payment/transaction/123456',
  ]);
  assert.equal(p.available(), false);
});

void test('wrong amount/currency/merchant/invoice/payment identity/subscription are rejected, not coerced', async () => {
  for (const overrides of [
    { amount: 9999 },
    { amount: '10000' },
    { amount: 1000000 },
    { currency: 'USD' },
    { terminalID: randomUUID() },
    { terminalID: undefined, terminal: config.terminalId },
    { accountID: randomUUID() },
    { accountID: '' },
    { invoiceID: '654321' },
    { id: randomUUID() },
    { id: undefined },
    { amountBonus: 10 },
    { orgAmount: 10001 },
  ])
    await assert.rejects(
      provider({
        resultCode: '100',
        transaction: transaction(overrides),
      }).getPaymentStatus(reference),
      unavailable,
    );
  for (const body of [
    null,
    [],
    {},
    { resultCode: 100, transaction: transaction() },
    { resultCode: '103', transaction: transaction() },
  ])
    await assert.rejects(
      provider(body).getPaymentStatus(reference),
      unavailable,
    );
});

void test('resultCode success/AUTH/3D never means settled; only CHARGE succeeds', async () => {
  for (const [statusName, state] of [
    ['CHARGE', 'SUCCEEDED'],
    ['FAILED', 'FAILED'],
    ['REJECT', 'FAILED'],
    ['AUTH', 'PENDING'],
    ['NEW', 'PENDING'],
    ['FINGERPRINT', 'PENDING'],
    ['3D', 'PENDING'],
    ['REFUND', 'REVIEW_REQUIRED'],
    ['CANCEL', 'REVIEW_REQUIRED'],
    ['CANCEL_OLD', 'REVIEW_REQUIRED'],
    ['VERIFIED', 'REVIEW_REQUIRED'],
    ['unknown', 'REVIEW_REQUIRED'],
  ]) {
    const result = await provider({
      resultCode: '100',
      transaction: transaction({ statusName }),
    }).getPaymentStatus(reference);
    assert.equal(result.state, state);
  }
  for (const resultCode of ['101', '102', '107']) {
    assert.equal(
      (
        await provider({ resultCode, transaction: null }).getPaymentStatus(
          reference,
        )
      ).state,
      'PENDING',
    );
  }
});

void test('late status and repeated observations preserve binding and cannot expose card data or renew a period', async () => {
  const p = provider({
    resultCode: '100',
    transaction: transaction({
      createdDate: '2020-01-01T00:00:00Z',
      cardMask: 'sensitive-mask-fixture',
      cardID: 'sensitive-card-token-fixture',
      email: 'private@example.test',
      ip: '192.0.2.1',
      data: 'private-merchant-data',
    }),
  });
  const first = await p.getPaymentStatus(reference);
  assert.deepEqual(await p.getPaymentStatus(reference), first);
  assert.deepEqual(Object.keys(first).sort(), [
    'amountMinor',
    'currency',
    'provider',
    'reference',
    'state',
  ]);
  for (const text of [
    'sensitive',
    'private',
    '192.0.2',
    'period',
    token.access_token,
    config.clientSecret,
  ])
    assert.ok(!JSON.stringify(first).includes(text));
  assert.ok(Object.isFrozen(first));
  assert.ok(Object.isFrozen(first.reference));
});

void test('lookup rejects path injection and malformed internal references before any network access', async () => {
  const calls: { url: string; init: RequestInit }[] = [];
  const p = provider({}, calls);
  for (const bad of [
    { invoiceId: '../123456' },
    { invoiceId: '123456?terminal=evil' },
    { invoiceId: '12345' },
    { invoiceId: '1'.repeat(16) },
    { attemptId: 'bad' },
    { subscriptionId: 'bad' },
    { providerPaymentId: 'bad' },
  ])
    await assert.rejects(p.getPaymentStatus({ ...reference, ...bad }));
  assert.equal(calls.length, 0);
});

void test('invalid OAuth responses, upstream failure, redirect, malformed/oversized body all fail without retry or secret disclosure', async () => {
  const fixtures: (() => Response)[] = [
    () => json({ ...token, access_token: 'bad\r\nsecret-header' }),
    () => json({ ...token, token_type: 'Basic' }),
    () => json({ ...token, expires_in: 0 }),
    () => new Response('secret-upstream-error', { status: 500 }),
    () =>
      new Response(null, {
        status: 302,
        headers: { location: 'https://attacker.invalid/' },
      }),
    () =>
      new Response('<html>secret</html>', {
        headers: { 'content-type': 'text/html' },
      }),
    () =>
      new Response('{secret', {
        headers: { 'content-type': 'application/json' },
      }),
    () => json({ secret: 'x'.repeat(65537) }),
    () =>
      new Response('{}', {
        headers: {
          'content-type': 'application/json',
          'content-length': '70000',
        },
      }),
  ];
  for (const fixture of fixtures) {
    let calls = 0;
    const p = new HalykPaymentProvider(config, () => {
      calls++;
      return Promise.resolve(fixture());
    });
    await assert.rejects(p.getPaymentStatus(reference), (e: unknown) => {
      assert.ok(e instanceof ServiceUnavailableException);
      assert.equal(e.message, 'Halyk status could not be verified');
      assert.equal(e.cause, undefined);
      return true;
    });
    assert.equal(calls, 1);
  }
});

void test('network ambiguity is not a failed payment and transport errors are sanitized', async () => {
  let calls = 0;
  const transport: HalykTransport = () => {
    calls++;
    return Promise.reject(new Error('credential leak ' + config.clientSecret));
  };
  await assert.rejects(
    new HalykPaymentProvider(config, transport).getPaymentStatus(reference),
    unavailable,
  );
  assert.equal(calls, 1);
});

void test('slow HTTP response is aborted within the bounded timeout, with no automatic retry', async () => {
  let calls = 0;
  const p = new HalykPaymentProvider(config, (_url, init) => {
    calls++;
    return new Promise<Response>((_resolve, reject) => {
      assert.ok(init.signal);
      init.signal.addEventListener(
        'abort',
        () => reject(new Error('aborted')),
        { once: true },
      );
    });
  });
  const started = performance.now();
  await assert.rejects(p.getPaymentStatus(reference), unavailable);
  assert.ok(performance.now() - started < 10000);
  assert.equal(calls, 1);
});
