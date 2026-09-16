import 'reflect-metadata';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { Secret, TOTP } from 'otpauth';
import {
  adminCookieName,
  adminCookieOptions,
  decryptTotp,
  encryptTotp,
  encryptionKey,
  TotpSecondFactor,
} from '../src/admin/security.js';
import { loadConfig } from '../src/config.js';
void test('admin cookies are distinct, HttpOnly, Strict and Secure in production', () => {
  const config = loadConfig({
    NODE_ENV: 'production',
    DATABASE_URL: 'postgresql://user:local@localhost/test',
    APP_ORIGIN: 'https://qrg.example.test',
    AUTH_RATE_LIMIT_SECRET: 'local-test-only-32-character-secret-string',
  });
  assert.equal(adminCookieName(config), '__Host-qrg_admin');
  assert.deepEqual(adminCookieOptions(config), {
    httpOnly: true,
    secure: true,
    sameSite: 'strict',
    path: '/',
  });
});
void test('TOTP secret authenticated encryption binds account, random nonce and key', () => {
  const secret = new Secret({ size: 20 }).base32,
    key = randomBytes(32),
    user = randomUUID();
  const encrypted = encryptTotp(secret, user, key);
  assert.ok(!encrypted.includes(secret));
  assert.notEqual(encrypted, encryptTotp(secret, user, key));
  assert.equal(decryptTotp(encrypted, user, key), secret);
  assert.throws(() => decryptTotp(encrypted, randomUUID(), key));
  assert.throws(() => decryptTotp(encrypted, user, randomBytes(32)));
  assert.throws(() => encryptionKey('bad'));
});
void test('TOTP requires configured key, exact six digits and a new step in every environment', () => {
  const previous = process.env.ADMIN_MFA_ENCRYPTION_KEY;
  const key = randomBytes(32),
    user = randomUUID(),
    secret = new Secret({ size: 20 }).base32;
  const encrypted = encryptTotp(secret, user, key);
  const verifier = new TotpSecondFactor();
  try {
    delete process.env.ADMIN_MFA_ENCRYPTION_KEY;
    assert.throws(() => verifier.verify(encrypted, user, '123456', -1));
    process.env.ADMIN_MFA_ENCRYPTION_KEY = key.toString('base64');
    const code = new TOTP({ secret }).generate();
    const step = verifier.verify(encrypted, user, code, -1);
    assert.throws(() => verifier.verify(encrypted, user, code, step));
    assert.throws(() => verifier.verify(encrypted, user, code.slice(0, 1), -1));
    assert.throws(() =>
      verifier.verify(
        encrypted,
        user,
        new TOTP({ secret }).generate({ timestamp: Date.now() - 120000 }),
        -1,
      ),
    );
  } finally {
    if (previous === undefined) delete process.env.ADMIN_MFA_ENCRYPTION_KEY;
    else process.env.ADMIN_MFA_ENCRYPTION_KEY = previous;
  }
});
