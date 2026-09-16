import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { Request } from 'express';
import { loadConfig } from '../src/config.js';
import {
  cookieOptions,
  csrfFor,
  matchesCsrf,
  newToken,
  readSessionToken,
  sessionCookieName,
  tokenHash,
} from '../src/auth/tokens.js';
import {
  hasPermission,
  permissions,
} from '../src/authorization/permissions.js';
import { UnconfiguredPasswordResetDelivery } from '../src/auth/delivery.js';

const config = loadConfig({
  NODE_ENV: 'test',
  DATABASE_URL: 'postgresql://test:local@localhost/qrg_test',
});
await test('256-bit opaque tokens, SHA-256 storage hashes and session-bound CSRF', () => {
  const first = newToken();
  const second = newToken();
  assert.equal(Buffer.from(first, 'base64url').length, 32);
  assert.notEqual(first, second);
  assert.match(tokenHash(first), /^[0-9a-f]{64}$/);
  assert.notEqual(tokenHash(first), first);
  assert.ok(matchesCsrf(csrfFor(first), csrfFor(first)));
  assert.ok(!matchesCsrf(csrfFor(second), csrfFor(first)));
  assert.ok(!matchesCsrf('short', csrfFor(first)));
});
await test('cookie policy is host-only, HttpOnly, SameSite and Secure with __Host- prefix in production', () => {
  const production = loadConfig({
    NODE_ENV: 'production',
    DATABASE_URL: config.databaseUrl,
    APP_ORIGIN: 'https://qrg.example',
    AUTH_RATE_LIMIT_SECRET: 'test-secret-at-least-32-characters-long',
  });
  assert.deepEqual(cookieOptions(config), {
    httpOnly: true,
    secure: false,
    sameSite: 'lax',
    path: '/',
  });
  assert.deepEqual(cookieOptions(production), {
    httpOnly: true,
    secure: true,
    sameSite: 'lax',
    path: '/',
  });
  assert.equal(sessionCookieName(production), '__Host-qrg_session');
  const token = newToken();
  assert.equal(
    readSessionToken(
      { headers: { cookie: `qrg_session=${token}` } } as Request,
      config,
    ),
    token,
  );
  assert.equal(
    readSessionToken(
      {
        headers: { cookie: `qrg_session=${token}; qrg_session=${token}` },
      } as Request,
      config,
    ),
    undefined,
  );
  assert.equal(
    readSessionToken(
      { headers: { cookie: 'qrg_session=invalid' } } as Request,
      config,
    ),
    undefined,
  );
});
await test('role/permission matrix grants staff no shop settings or employee management access', () => {
  for (const permission of permissions)
    assert.equal(hasPermission('SHOP_OWNER', permission), true);
  for (const role of ['SHOP_MANAGER', 'SHOP_EMPLOYEE'] as const) {
    assert.equal(hasPermission(role, 'shop.read'), true);
    for (const permission of [
      'shop.settings.write',
      'members.read',
      'members.write',
    ] as const)
      assert.equal(hasPermission(role, permission), false);
  }
});
await test('production reset delivery is explicitly unavailable, not a successful mock', async () => {
  const delivery = new UnconfiguredPasswordResetDelivery();
  assert.equal(delivery.available(), false);
  await assert.rejects(delivery.send());
});
