import 'reflect-metadata';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { adminPermissions } from '../src/admin/auth.js';
import { adminAccounts } from '../src/db/schema.js';
import {
  AdminActionDto,
  AdminCreateDto,
  UserActionDto,
} from '../src/admin/control.dto.js';
import {
  DraftSaveDto,
  BulkProductDto,
} from '../src/catalogue/operations.dto.js';
const validation = { whitelist: true, forbidNonWhitelisted: true };
function account(role: string): typeof adminAccounts.$inferSelect {
  return {
    userId: randomUUID(),
    role,
    enabled: true,
    mustChangePassword: false,
    totpEncrypted: 'encrypted-fixture',
    pendingTotpEncrypted: null,
    recoveryHashes: [],
    lastTotpStep: -1,
    canModerate: false,
    canSuspend: false,
    canReadAudit: false,
    createdAt: new Date(),
    updatedAt: new Date(),
  };
}
void test('platform roles remain separate and limited roles never get super-admin actions', () => {
  assert.ok(adminPermissions(account('SUPER_ADMIN')).includes('admins.write'));
  for (const role of [
    'MODERATION_ADMIN',
    'SUPPORT_ADMIN',
    'FINANCE_ADMIN',
    'ADMIN',
  ]) {
    assert.ok(!adminPermissions(account(role)).includes('admins.write'));
    assert.ok(!adminPermissions(account(role)).includes('users.write'));
  }
  assert.ok(
    !adminPermissions(account('FINANCE_ADMIN')).includes('moderation.write'),
  );
  assert.ok(
    !adminPermissions(account('SUPPORT_ADMIN')).includes('products.moderate'),
  );
});
void test('temporary password and missing MFA restrict every privileged account to security setup', () => {
  assert.deepEqual(
    adminPermissions({ ...account('SUPER_ADMIN'), mustChangePassword: true }),
    ['session', 'security'],
  );
  assert.deepEqual(
    adminPermissions({ ...account('SUPER_ADMIN'), totpEncrypted: null }),
    ['session', 'security'],
  );
});
void test('typed admin actions reject unsafe roles, mass assignment and blank reasons', async () => {
  for (const value of ['super_owner_everything', 'SHOP_OWNER', 'ADMIN'])
    assert.ok(
      (
        await validate(
          plainToInstance(AdminActionDto, {
            action: 'CHANGE_ROLE',
            role: value,
            reason: 'Проверка',
          }),
          validation,
        )
      ).length,
    );
  assert.ok(
    (
      await validate(
        plainToInstance(UserActionDto, {
          action: 'SHOP_ROLE',
          membershipId: randomUUID(),
          role: 'SUPER_ADMIN',
          reason: 'Проверка',
        }),
        validation,
      )
    ).length,
  );
  for (const field of [
    'isAdmin',
    'paymentStatus',
    'subscriptionStatus',
    'verified',
    'ownerId',
  ])
    assert.ok(
      (
        await validate(
          plainToInstance(AdminCreateDto, {
            email: 'fixture@example.test',
            temporaryPassword: 'Only a fixture password!',
            role: 'SUPPORT_ADMIN',
            reason: 'Проверка',
            [field]: true,
          }),
          validation,
        )
      ).length,
    );
  assert.ok(
    (
      await validate(
        plainToInstance(UserActionDto, { action: 'DISABLE', reason: '   ' }),
        validation,
      )
    ).length,
  );
});
void test('draft allows incomplete content but rejects ownership/status injection, invalid money and missing body', async () => {
  assert.equal(
    (
      await validate(
        plainToInstance(DraftSaveDto, { version: 0, content: {} }),
        validation,
      )
    ).length,
    0,
  );
  for (const content of [
    { status: 'PUBLISHED' },
    { shopId: randomUUID() },
    { ownerId: randomUUID() },
    { basePrice: -1 },
    { basePrice: 0.001 },
    { basePrice: '1000' },
  ])
    assert.ok(
      (
        await validate(
          plainToInstance(DraftSaveDto, { version: 0, content }),
          validation,
        )
      ).length,
    );
  assert.ok(
    (await validate(plainToInstance(DraftSaveDto, { version: 0 }), validation))
      .length,
  );
});
void test('bulk product actions require unique bounded IDs and finite action enum', async () => {
  const id = randomUUID();
  for (const body of [
    { ids: [], action: 'HIDE' },
    { ids: [id, id], action: 'PUBLISH' },
    { ids: Array.from({ length: 51 }, () => randomUUID()), action: 'HIDE' },
    { ids: [id], action: 'DELETE_ALL' },
    { ids: [id], action: 'PUBLISH', shopId: randomUUID() },
  ])
    assert.ok(
      (await validate(plainToInstance(BulkProductDto, body), validation))
        .length,
    );
});
