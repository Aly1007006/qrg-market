import 'reflect-metadata';
import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { test } from 'node:test';
import {
  BadRequestException,
  ServiceUnavailableException,
} from '@nestjs/common';
import {
  HalykHttpClient,
  type HalykTransport,
} from '../src/subscriptions/halyk/client.js';
import {
  HALYK_ENDPOINTS,
  type HalykConfig,
} from '../src/subscriptions/halyk/config.js';
import { HalykPaymentProvider } from '../src/subscriptions/halyk/provider.js';
import type {
  InitialPaymentCommand,
  RecurringPaymentCommand,
} from '../src/subscriptions/provider.js';

// Offline wire-contract tests only. No bank credentials or network calls, and no
// override of the production provider gate. These commands are not a checkout flow.
const config: HalykConfig = {
  environment: 'sandbox',
  terminalId: randomUUID(),
  clientId: 'qrg-offline-command-test',
  clientSecret: 'offline-only-secret',
};
const initial: InitialPaymentCommand = {
  attemptId: randomUUID(),
  subscriptionId: randomUUID(),
  invoiceId: '123456',
  returnUrl: 'https://qrg.example.test/seller/subscription',
  callbackUrl: 'https://api.qrg.example.test/api/v1/subscription-callback',
  callbackSecret: randomBytes(32).toString('base64url'),
};
const recurring: RecurringPaymentCommand = {
  attemptId: initial.attemptId,
  subscriptionId: initial.subscriptionId,
  invoiceId: initial.invoiceId,
  returnUrl: initial.returnUrl,
  callbackUrl: initial.callbackUrl,
  savedCardToken: randomUUID(),
};
const token = {
  access_token: 'offline-operation-token',
  expires_in: 7200,
  refresh_token: '',
  scope: 'payment',
  token_type: 'Bearer',
};
const paymentId = randomUUID();
const authResult = {
  code: 0,
  id: paymentId,
  status: 'AUTH',
  secure3D: null,
  invoiceID: recurring.invoiceId,
  accountId: '',
  amount: 10000,
  amountBonus: 0,
  currency: 'KZT',
};
const json = (value: unknown) =>
  new Response(JSON.stringify(value), {
    headers: { 'content-type': 'application/json' },
  });
type Call = { url: string; init: RequestInit };
function client(
  result: unknown = authResult,
  authorization: unknown = token,
  environment: HalykConfig['environment'] = 'sandbox',
) {
  const calls: Call[] = [];
  const transport: HalykTransport = (url, init) => {
    calls.push({ url, init });
    return Promise.resolve(
      json(url.endsWith('/oauth2/token') ? authorization : result),
    );
  };
  return {
    client: new HalykHttpClient({ ...config, environment }, transport),
    calls,
  };
}
function form(call: Call | undefined) {
  assert.ok(call?.init.body instanceof FormData);
  return Object.fromEntries(call.init.body.entries());
}
const unavailable = (error: unknown) =>
  error instanceof ServiceUnavailableException;

void test('initial token is invoice/amount-bound; hosted payload contains only documented safe fields', async () => {
  const fixture = client(undefined, {
    ...token,
    client_secret: config.clientSecret,
    secret_hash: initial.callbackSecret,
  });
  // Extra fields must not become a bank amount, PII, mandate or redirect override.
  const command = {
    ...initial,
    amount: 1,
    currency: 'USD',
    cardSave: true,
    recurrent: true,
    email: 'private@example.test',
  };
  const checkout = await fixture.client.initialPayment(command);
  assert.equal(fixture.calls.length, 1);
  assert.equal(fixture.calls[0]!.url, HALYK_ENDPOINTS.sandbox.oauth);
  assert.equal(fixture.calls[0]!.init.method, 'POST');
  assert.deepEqual(form(fixture.calls[0]), {
    grant_type: 'client_credentials',
    scope:
      'webapi usermanagement email_send verification statement statistics payment',
    client_id: config.clientId,
    client_secret: config.clientSecret,
    terminal: config.terminalId,
    invoiceID: initial.invoiceId,
    amount: '10000',
    currency: 'KZT',
    postLink: initial.callbackUrl,
    failurePostLink: initial.callbackUrl,
    secret_hash: initial.callbackSecret,
  });
  assert.deepEqual(checkout, {
    kind: 'hosted-script',
    scriptUrl: 'https://test-epay.epayment.kz/payform/payment-api.js',
    payload: {
      invoiceId: initial.invoiceId,
      backLink: initial.returnUrl,
      failureBackLink: initial.returnUrl,
      postLink: initial.callbackUrl,
      failurePostLink: initial.callbackUrl,
      language: 'rus',
      description: 'QRG BUSINESS subscription',
      accountId: initial.subscriptionId,
      terminal: config.terminalId,
      amount: 10000,
      currency: 'KZT',
      auth: token,
    },
  });
  for (const secret of [
    config.clientSecret,
    initial.callbackSecret,
    'private@example.test',
  ])
    assert.ok(!JSON.stringify(checkout).includes(secret));
  assert.ok(Object.isFrozen(checkout.payload.auth));
  assert.ok(Object.isFrozen(checkout.payload));
});

void test('recurring uses one documented saved-card POST with a fresh token; AUTH remains unresolved', async () => {
  const fixture = client({
    ...authResult,
    cardID: recurring.savedCardToken,
    phone: 'private-phone',
    email: 'private-email',
  });
  const command = {
    ...recurring,
    amount: 0,
    currency: 'USD',
    callbackSecret: initial.callbackSecret,
  };
  const result = await fixture.client.recurringPayment(command);
  assert.equal(fixture.calls.length, 2);
  const oauth = form(fixture.calls[0]);
  assert.equal(oauth.amount, '10000');
  assert.equal(oauth.currency, 'KZT');
  assert.equal(oauth.invoiceID, recurring.invoiceId);
  assert.equal(oauth.secret_hash, undefined); // not documented for this OAuth flow
  const call = fixture.calls[1]!;
  assert.equal(
    call.url,
    'https://test-epay-api.epayment.kz/payments/cards/auth',
  );
  assert.equal(call.init.method, 'POST');
  assert.equal(
    new Headers(call.init.headers).get('authorization'),
    'Bearer ' + token.access_token,
  );
  assert.equal(
    new Headers(call.init.headers).get('content-type'),
    'application/json',
  );
  assert.equal(typeof call.init.body, 'string');
  assert.deepEqual(JSON.parse(call.init.body as string), {
    amount: 10000,
    currency: 'KZT',
    terminalId: config.terminalId,
    invoiceId: recurring.invoiceId,
    description: 'QRG BUSINESS subscription',
    accountId: recurring.subscriptionId,
    backLink: recurring.returnUrl,
    failureBackLink: recurring.returnUrl,
    postLink: recurring.callbackUrl,
    failurePostLink: recurring.callbackUrl,
    language: 'rus',
    paymentType: 'cardId',
    recurrent: true,
    cardId: { id: recurring.savedCardToken },
  });
  assert.deepEqual(result, {
    providerPaymentId: paymentId,
    state: 'PENDING_RECONCILIATION',
  });
  assert.ok(Object.isFrozen(result));
  for (const call of fixture.calls) {
    assert.equal(call.init.redirect, 'error');
    assert.equal(call.init.cache, 'no-store');
    assert.equal(call.init.credentials, 'omit');
  }
});

void test('3DS intermediate response is not payment success and cannot leak challenge or card data', async () => {
  const fixture = client({
    code: 0,
    id: paymentId,
    status: '3D',
    invoiceID: '',
    currency: '',
    secure3D: {
      paReq: 'private-challenge',
      md: 'private-md',
      action: 'https://attacker.example.test',
    },
    cardID: recurring.savedCardToken,
  });
  assert.deepEqual(await fixture.client.recurringPayment(recurring), {
    providerPaymentId: paymentId,
    state: 'REQUIRES_ACTION',
  });
  assert.equal(fixture.calls.length, 2);
});

void test('recurring rejects mismatched identity/amount/currency and unrecognized submission states', async () => {
  for (const patch of [
    { invoiceID: '654321' },
    { amount: 1 },
    { amount: '10000' },
    { currency: 'USD' },
    { accountId: randomUUID() },
    { amountBonus: 1 },
    { id: '' },
    { code: '0' },
    { status: 'CHARGE' },
    { status: 'FAILED' },
    { status: 'unknown' },
    { secure3D: {} },
  ]) {
    const fixture = client({ ...authResult, ...patch });
    await assert.rejects(
      fixture.client.recurringPayment(recurring),
      unavailable,
    );
    assert.equal(fixture.calls.length, 2);
  }
  for (const body of [
    null,
    [],
    {},
    { code: -1, message: 'private-bank-message' },
  ])
    await assert.rejects(
      client(body).client.recurringPayment(recurring),
      unavailable,
    );
});

void test('missing/wrong operation credentials and malformed IDs are rejected before OAuth', async () => {
  for (const patch of [
    { attemptId: '../evil' },
    { subscriptionId: '' },
    { invoiceId: '123456?evil' },
    { invoiceId: '012345' },
    { invoiceId: '1234567' },
    { callbackSecret: '' },
    { callbackSecret: undefined },
  ]) {
    const fixture = client();
    await assert.rejects(
      fixture.client.initialPayment({
        ...initial,
        ...patch,
      } as InitialPaymentCommand),
      BadRequestException,
    );
    assert.equal(fixture.calls.length, 0);
  }
  const { callbackSecret: omitted, ...noSecret } = initial;
  assert.ok(omitted);
  await assert.rejects(
    client().client.initialPayment(noSecret as InitialPaymentCommand),
    BadRequestException,
  );
  for (const savedCardToken of ['', 'not-a-card-id', undefined]) {
    const fixture = client();
    await assert.rejects(
      fixture.client.recurringPayment({
        ...recurring,
        savedCardToken,
      } as RecurringPaymentCommand),
      BadRequestException,
    );
    assert.equal(fixture.calls.length, 0);
  }
});

void test('callback and return links reject unsafe URL shapes before any HTTP call', async () => {
  for (const url of [
    'http://qrg.example.test/path',
    'javascript:alert(1)',
    'https://user:password@qrg.example.test',
    'https://localhost/callback',
    'https://127.0.0.1/callback',
    'https://[::1]/callback',
    'https://qrg.example.test:8443/path',
    'https://qrg.example.test/path?amount=1',
    'https://qrg.example.test/path#secret',
    'https://qrg.example.test/ space',
    'https://qrg.example.test/\\evil',
  ]) {
    for (const field of ['callbackUrl', 'returnUrl'] as const) {
      const fixture = client();
      await assert.rejects(
        fixture.client.initialPayment({ ...initial, [field]: url }),
        BadRequestException,
      );
      assert.equal(fixture.calls.length, 0);
    }
  }
});

void test('invalid OAuth response cannot reach recurring POST or leak raw credentials in errors', async () => {
  for (const authorization of [
    {},
    { ...token, scope: 'statement' },
    { ...token, scope: 'payment-evil' },
    { ...token, refresh_token: 'private-refresh-token' },
    { ...token, expires_in: 0 },
    { ...token, access_token: 'token\r\ninjection' },
  ]) {
    const fixture = client(authResult, authorization);
    await assert.rejects(
      fixture.client.recurringPayment(recurring),
      (error: unknown) => {
        assert.ok(error instanceof ServiceUnavailableException);
        assert.ok(!JSON.stringify(error).includes(config.clientSecret));
        assert.ok(!JSON.stringify(error).includes('private-refresh-token'));
        return true;
      },
    );
    assert.equal(fixture.calls.length, 1);
  }
});

void test('ambiguous recurring transport errors and declines never retry a POST or become a ledger outcome', async () => {
  for (const mode of ['network', 'decline', 'redirect'] as const) {
    const calls: string[] = [];
    const transport: HalykTransport = (url) => {
      calls.push(url);
      if (url.endsWith('/oauth2/token')) return Promise.resolve(json(token));
      if (mode === 'network')
        return Promise.reject(new Error('private-network-context'));
      return Promise.resolve(
        new Response('private-bank-message', {
          status: mode === 'decline' ? 400 : 302,
          headers: {
            'content-type': 'application/json',
            location: 'https://attacker.example.test',
          },
        }),
      );
    };
    await assert.rejects(
      new HalykHttpClient(config, transport).recurringPayment(recurring),
      (error: unknown) => {
        assert.ok(error instanceof ServiceUnavailableException);
        assert.ok(!JSON.stringify(error).includes('private-'));
        return true;
      },
    );
    assert.equal(calls.length, 2);
  }
});

void test('recurring POST timeout aborts and sends exactly one charge request', async () => {
  let posts = 0;
  const transport: HalykTransport = (url, init) => {
    if (url.endsWith('/oauth2/token')) return Promise.resolve(json(token));
    posts++;
    return new Promise<Response>((_resolve, reject) => {
      assert.ok(init.signal);
      init.signal.addEventListener(
        'abort',
        () => reject(new Error('offline timeout')),
        { once: true },
      );
    });
  };
  await assert.rejects(
    new HalykHttpClient(config, transport).recurringPayment(recurring),
    unavailable,
  );
  assert.equal(posts, 1);
});

void test('in-flight mutation cannot replace terminal, invoice, card or subscription', async () => {
  const mutableConfig = { ...config };
  const command = { ...recurring };
  let submitted: unknown;
  const transport: HalykTransport = (url, init) => {
    if (url.endsWith('/oauth2/token')) {
      mutableConfig.terminalId = randomUUID();
      command.invoiceId = '654321';
      command.subscriptionId = randomUUID();
      command.savedCardToken = randomUUID();
      return Promise.resolve(json(token));
    }
    assert.equal(typeof init.body, 'string');
    submitted = JSON.parse(init.body as string) as unknown;
    return Promise.resolve(json(authResult));
  };
  await new HalykHttpClient(mutableConfig, transport).recurringPayment(command);
  assert.ok(submitted && typeof submitted === 'object');
  assert.equal(Reflect.get(submitted, 'invoiceId'), recurring.invoiceId);
  assert.equal(Reflect.get(submitted, 'accountId'), recurring.subscriptionId);
  assert.equal(Reflect.get(submitted, 'terminalId'), config.terminalId);
  assert.deepEqual(Reflect.get(submitted, 'cardId'), {
    id: recurring.savedCardToken,
  });
});

void test('production wire contracts use only official endpoints, tested with offline transport', async () => {
  const fixture = client(authResult, token, 'production');
  const checkout = await fixture.client.initialPayment(initial);
  assert.equal(
    checkout.scriptUrl,
    'https://epay.homebank.kz/payform/payment-api.js',
  );
  await fixture.client.recurringPayment(recurring);
  assert.deepEqual(
    fixture.calls.map((call) => call.url),
    [
      'https://epay-oauth.homebank.kz/oauth2/token',
      'https://epay-oauth.homebank.kz/oauth2/token',
      'https://epay-api.homebank.kz/payments/cards/auth',
    ],
  );
});

void test('even complete valid commands cannot bypass the production provider release gate', async () => {
  let calls = 0;
  const provider = new HalykPaymentProvider(config, () => {
    calls++;
    return Promise.resolve(json(token));
  });
  assert.equal(provider.available(), false);
  await assert.rejects(provider.createInitialPayment(initial), unavailable);
  await assert.rejects(provider.chargeRecurring(recurring), unavailable);
  assert.equal(calls, 0);
});
