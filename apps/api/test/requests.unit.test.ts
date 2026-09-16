import 'reflect-metadata';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';
import {
  challengeFor,
  verifyChallenge,
  ConfiguredCaptchaPolicy,
} from '../src/requests/spam.js';
import { PRIVACY_VERSION } from '../src/requests/dto.js';
void test('lead form challenge binds product, signature and bounded elapsed time', () => {
  const id = randomUUID(),
    secret = 'unit-only-request-secret-at-least-32-characters',
    now = Date.now();
  const token = challengeFor(id, secret, now - 3000);
  verifyChallenge(token, id, secret, now);
  for (const [t, p, s, n] of [
    [token, randomUUID(), secret, now],
    [token, id, 'wrong', now],
    [token + 'x', id, secret, now],
    [challengeFor(id, secret, now), id, secret, now],
    [token, id, secret, now + 1800000],
  ] as const)
    assert.throws(() => verifyChallenge(t, p, s, n));
  assert.equal(PRIVACY_VERSION, 'request-privacy-v1');
});
void test('CAPTCHA required without provider fails closed; optional mode does not claim verification', async () => {
  const old = process.env.REQUEST_CAPTCHA_REQUIRED;
  try {
    process.env.REQUEST_CAPTCHA_REQUIRED = 'true';
    const policy = new ConfiguredCaptchaPolicy();
    await assert.rejects(async () =>
      policy.verify({
        action: 'customer-request',
        productId: randomUUID(),
        token: 'forged',
      }),
    );
    process.env.REQUEST_CAPTCHA_REQUIRED = 'false';
    await new ConfiguredCaptchaPolicy().verify({
      action: 'customer-request',
      productId: randomUUID(),
    });
  } finally {
    if (old === undefined) delete process.env.REQUEST_CAPTCHA_REQUIRED;
    else process.env.REQUEST_CAPTCHA_REQUIRED = old;
  }
});
