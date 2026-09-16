import { test } from 'node:test';
import assert from 'node:assert/strict';
import { allowedSellerRoute, sessionCookie } from '../lib/seller/boundary.ts';
void test('seller BFF allows only explicit scoped routes and methods', () => {
  const id = '12345678-1234-4123-8123-123456789abc';
  assert.ok(allowedSellerRoute(`shops/${id}/products/${id}/images`, 'POST'));
  for (const path of [
    'https://evil.test',
    '../admin',
    'shops//products',
    'auth/password-reset/confirm',
    'public/catalog',
    `shops/${id}/products/${id}/images/../../admin`,
  ])
    assert.equal(allowedSellerRoute(path, 'POST'), false);
  assert.equal(allowedSellerRoute('auth/login', 'GET'), false);
});
void test('BFF forwards only opaque session cookies, no unrelated credentials', () => {
  const token = 'a'.repeat(43);
  assert.equal(
    sessionCookie(`tracking=secret; qrg_session=${token}; admin=secret`),
    `qrg_session=${token}`,
  );
  assert.equal(sessionCookie('qrg_session=bad; authorization=secret'), '');
});
