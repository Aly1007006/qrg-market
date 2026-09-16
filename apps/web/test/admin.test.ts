import { test } from 'node:test';
import assert from 'node:assert/strict';
import { allowedAdminRoute, adminCookie } from '../lib/admin/boundary.ts';
import { allowedSellerRoute } from '../lib/seller/boundary.ts';
import { moderationActions } from '../lib/moderation.ts';
test('admin BFF does not forward seller credentials or expose role/audit mutations', () => {
  const token = 'A'.repeat(43),
    id = '00000000-0000-4000-8000-000000000000';
  assert.equal(
    adminCookie(`qrg_session=${token}; qrg_admin=${token}; password=secret`),
    `qrg_admin=${token}`,
  );
  assert.ok(allowedAdminRoute('shops/' + id + '/decisions', 'POST'));
  for (const path of [
    '../shops',
    'auth/signup',
    'users/' + id + '/role',
    'audit/' + id,
  ])
    for (const method of ['GET', 'POST', 'PATCH', 'DELETE'])
      assert.equal(allowedAdminRoute(path, method), false);
  assert.equal(allowedAdminRoute('audit', 'DELETE'), false);
  assert.equal(
    allowedSellerRoute('admin/shops/' + id + '/decisions', 'POST'),
    false,
  );
});
test('UI moderation controls reflect explicit permissions and never expose ACTIVE', () => {
  assert.deepEqual(moderationActions('PENDING_VERIFICATION', []), []);
  const allowed = moderationActions('PENDING_VERIFICATION', [
    'moderation.write',
  ]);
  assert.equal(allowed.length, 3);
  assert.ok(!allowed.some((a) => ['SUSPEND', 'ACTIVE'].includes(a.value)));
  assert.equal(
    moderationActions('ACTIVE', ['moderation.suspend'])[0]?.value,
    'SUSPEND',
  );
});
