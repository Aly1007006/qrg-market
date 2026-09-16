import 'reflect-metadata';
import { paidFixtures, removeBillingFixtures } from './billing-fixtures.js';
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { createRequire } from 'node:module';
import { Test } from '@nestjs/testing';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Secret, TOTP } from 'otpauth';
import { and, eq, inArray, sql } from 'drizzle-orm';
import { AppModule } from '../src/app.module.js';
import { loadConfig } from '../src/config.js';
import { configureApplication } from '../src/http.js';
import { Database } from '../src/database.js';
import { runMigrations } from '../src/db/migrate.js';
import { cleanupExpired } from '../src/db/cleanup.js';
import { AuthService } from '../src/auth/service.js';
import { ShopsService } from '../src/shops/service.js';
import {
  adminAccounts,
  adminSessions,
  auditLogs,
  moderationCases,
  moderationHistory,
  shops,
  shopMembers,
  shopContacts,
  shopLocations,
  users,
} from '../src/db/schema.js';
import { encryptTotp } from '../src/admin/security.js';
import { csrfFor, tokenHash, newToken } from '../src/auth/tokens.js';
const run = randomUUID();
const config = loadConfig({
  ...process.env,
  NODE_ENV: 'test',
  APP_ORIGIN: 'http://127.0.0.1:43187',
  AUTH_RATE_LIMIT_SECRET: run + '-admin-test',
});
assert.ok(new URL(config.databaseUrl).pathname.endsWith('_test'));
const key = randomBytes(32),
  totpSecret = new Secret({ size: 20 }).base32;
const oldKey = process.env.ADMIN_MFA_ENCRYPTION_KEY;
const emails = ['seller', 'other', 'admin', 'reader'].map(
  (n) => run + '-' + n + '@example.test',
);
const password = 'Admin test fixture password 2026!';
let app: NestExpressApplication,
  db: Database,
  base: string,
  shopA: string,
  shopB: string,
  adminId: string,
  readerId: string;
let seller: Awaited<ReturnType<AuthService['login']>>, other: typeof seller;
let admin: { token: string; csrfToken: string }, reader: typeof admin;
async function request(
  path: string,
  method = 'GET',
  body?: unknown,
  session?: typeof admin,
  isSeller = false,
  extra: Record<string, string> = {},
) {
  return fetch(base + '/api/v1/' + path, {
    method,
    headers: {
      origin: config.appOrigin,
      'x-qrg-client': 'web',
      'content-type': 'application/json',
      ...(session
        ? {
            cookie: `${isSeller ? 'qrg_session' : 'qrg_admin'}=${session.token}`,
            'x-qrg-csrf': session.csrfToken,
          }
        : {}),
      ...extra,
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}
async function freshSession(userId: string) {
  // Fixture setup for independent expiry/revocation tests, not a runtime bypass.
  const token = newToken();
  await db.client.insert(adminSessions).values({
    userId,
    tokenHash: tokenHash(token),
    expiresAt: sql`now() + interval '1 hour'`,
  });
  return { token, csrfToken: csrfFor(token) };
}
async function submitShop(id = shopA, client = seller) {
  const r = await request(
    'shops/' + id + '/verification',
    'POST',
    {},
    client,
    true,
  );
  assert.equal(r.status, 200, await r.clone().text());
  return ((await r.json()) as { caseId: string }).caseId;
}
before(async () => {
  process.env.ADMIN_MFA_ENCRYPTION_KEY = key.toString('base64');
  await runMigrations(config, resolve('drizzle'));
  const module = await Test.createTestingModule({
    imports: [AppModule.register(config)],
  }).compile();
  app = module.createNestApplication<NestExpressApplication>({
    bodyParser: false,
    logger: false,
  });
  await configureApplication(app, config);
  await app.listen(0, '127.0.0.1');
  base = await app.getUrl();
  db = app.get(Database);
  const auth = app.get(AuthService),
    tenant = app.get(ShopsService);
  for (const email of emails) await auth.signup(email, password);
  seller = await auth.login(emails[0]!, password);
  other = await auth.login(emails[1]!, password);
  const ids = await db.client
    .select({ id: users.id, email: users.email })
    .from(users)
    .where(inArray(users.email, emails));
  adminId = ids.find((u) => u.email === emails[2])!.id;
  readerId = ids.find((u) => u.email === emails[3])!.id;
  await db.client.insert(adminAccounts).values([
    {
      userId: adminId,
      totpEncrypted: encryptTotp(totpSecret, adminId, key),
      canModerate: true,
      canSuspend: true,
      canReadAudit: true,
    },
    {
      userId: readerId,
      totpEncrypted: encryptTotp(
        new Secret({ size: 20 }).base32,
        readerId,
        key,
      ),
    },
  ]);
  reader = await freshSession(readerId);
  shopA = (
    await tenant.create(
      await auth.authenticate(seller.token),
      'Admin fixture A ' + run,
    )
  ).id;
  shopB = (
    await tenant.create(
      await auth.authenticate(other.token),
      'Admin fixture B ' + run,
    )
  ).id;
  for (const id of [shopA, shopB]) {
    await db.client
      .insert(shopLocations)
      .values({ shopId: id, address: 'Fixture address' });
    await db.client
      .insert(shopContacts)
      .values({ shopId: id, phone: '+77001234567' });
  }
});
after(async () => {
  if (db && shopA && shopB) await removeBillingFixtures(db, [shopA, shopB]);
  // Immutable audit/history intentionally remain in the isolated test DB with fixture IDs.
  if (db) {
    if (shopA && shopB)
      await db.client.delete(shops).where(inArray(shops.id, [shopA, shopB]));
    await db.client.delete(users).where(inArray(users.email, emails));
  }
  await app?.close();
  if (oldKey === undefined) delete process.env.ADMIN_MFA_ENCRYPTION_KEY;
  else process.env.ADMIN_MFA_ENCRYPTION_KEY = oldKey;
});
void test('seller/user cannot become ADMIN via login, cookie substitution, role API or unknown routes', async () => {
  for (const email of [emails[0]!, run + '-unknown@example.test'])
    assert.equal(
      (
        await request('admin/auth/login', 'POST', {
          email,
          password,
          code: new TOTP({ secret: totpSecret }).generate(),
        })
      ).status,
      401,
    );
  for (const path of [
    'admin/dashboard',
    'admin/shops',
    'admin/audit',
    'admin/shops/' + shopA,
  ]) {
    assert.equal((await request(path)).status, 401);
    assert.equal(
      (await request(path, 'GET', undefined, seller, true)).status,
      401,
    );
    assert.equal((await request(path, 'GET', undefined, seller)).status, 401);
  }
  assert.equal(
    (
      await request('auth/signup', 'POST', {
        email: run + '-fake@example.test',
        password,
        role: 'ADMIN',
      })
    ).status,
    400,
  );
  assert.equal(
    (
      await request(
        'users/' + seller.user.id + '/role',
        'PATCH',
        { role: 'ADMIN' },
        seller,
        true,
      )
    ).status,
    404,
  );
  assert.equal(
    (
      await request(
        'shops/' + shopA,
        'PATCH',
        { name: 'Forged', status: 'ACTIVE', role: 'ADMIN' },
        seller,
        true,
      )
    ).status,
    400,
  );
});
void test('admin requires real MFA, rejects OTP replay, issues separate short hashed session', async () => {
  const code = new TOTP({ secret: totpSecret }).generate();
  const invalid = code.slice(0, 5) + ((Number(code[5]) + 1) % 10);
  assert.equal(
    (
      await request('admin/auth/login', 'POST', {
        email: emails[2],
        password,
        code: invalid,
      })
    ).status,
    401,
  );
  assert.equal(
    (await request('admin/auth/login', 'POST', { email: emails[2], password }))
      .status,
    400,
  );
  const r = await request('admin/auth/login', 'POST', {
    email: emails[2],
    password,
    code,
  });
  assert.equal(r.status, 200, await r.clone().text());
  const cookie = r.headers.get('set-cookie')!;
  assert.match(cookie, /^qrg_admin=/);
  assert.match(cookie, /HttpOnly/);
  assert.match(cookie, /SameSite=Strict/);
  const data = (await r.json()) as { csrfToken: string; expiresAt: string };
  admin = {
    token: cookie.split(';')[0]!.slice('qrg_admin='.length),
    csrfToken: data.csrfToken,
  };
  const [row] = await db.client
    .select()
    .from(adminSessions)
    .where(eq(adminSessions.tokenHash, tokenHash(admin.token)));
  assert.ok(row);
  assert.notEqual(row.tokenHash, admin.token);
  assert.equal(row.expiresAt.getTime() - row.createdAt.getTime(), 3600000);
  assert.equal(
    (
      await request('admin/auth/login', 'POST', {
        email: emails[2],
        password,
        code,
      })
    ).status,
    401,
  );
  assert.equal(
    (await request('admin/auth/me', 'GET', undefined, admin)).status,
    200,
  );
  assert.equal((await request('auth/me', 'GET', undefined, admin)).status, 401);
});
void test('seller verification is tenant-scoped, freezes reviewed identity and does not publish', async () => {
  assert.equal(
    (
      await request(
        'shops/' + shopB + '/verification',
        'POST',
        {},
        seller,
        true,
      )
    ).status,
    404,
  );
  assert.equal(
    (
      await request(
        'shops/' + shopB + '/verification',
        'GET',
        undefined,
        seller,
        true,
      )
    ).status,
    404,
  );
  await submitShop();
  assert.equal(
    (
      await request(
        'shops/' + shopA + '/verification',
        'POST',
        {},
        seller,
        true,
      )
    ).status,
    409,
  );
  assert.equal(
    (
      await request(
        'shops/' + shopA,
        'PATCH',
        { name: 'Swapped identity' },
        seller,
        true,
      )
    ).status,
    409,
  );
  assert.equal(
    (
      await request(
        'shops/' + shopA + '/contacts',
        'PUT',
        { phone: '+77001234568' },
        seller,
        true,
      )
    ).status,
    409,
  );
  const [shop] = await db.client
    .select()
    .from(shops)
    .where(eq(shops.id, shopA));
  assert.equal(shop?.status, 'PENDING_VERIFICATION');
});
void test('moderation checks per-action permission, CSRF, case/shop association and mass assignment', async () => {
  const [entry] = await db.client
    .select()
    .from(moderationCases)
    .where(eq(moderationCases.shopId, shopA));
  assert.ok(entry);
  const data = {
    action: 'APPROVE',
    expectedStatus: 'PENDING_VERIFICATION',
    caseId: entry.id,
  };
  const path = 'admin/shops/' + shopA + '/decisions';
  assert.equal((await request(path, 'POST', data, reader)).status, 403);
  assert.equal(
    (await request('admin/audit', 'GET', undefined, reader)).status,
    403,
  );
  assert.equal(
    (await request(path, 'POST', data, admin, false, { 'x-qrg-csrf': '' }))
      .status,
    403,
  );
  assert.equal(
    (
      await request(path, 'POST', data, admin, false, {
        origin: 'https://evil.test',
      })
    ).status,
    403,
  );
  assert.equal(
    (await request(path, 'POST', { ...data, caseId: randomUUID() }, admin))
      .status,
    404,
  );
  assert.equal(
    (await request(path, 'POST', { ...data, shop_id: shopB }, admin)).status,
    400,
  );
  assert.equal(
    (await request(path, 'POST', { ...data, action: 'ACTIVE' }, admin)).status,
    400,
  );
  assert.equal(
    (
      await request(
        'admin/shops/' + shopB + '/decisions',
        'POST',
        { ...data, expectedStatus: 'DRAFT' },
        admin,
      )
    ).status,
    404,
  );
});
void test('REQUEST_CHANGES and REJECT require reasons visible only to the correct seller', async () => {
  let [entry] = await db.client
    .select()
    .from(moderationCases)
    .where(and(eq(moderationCases.shopId, shopA), sql`closed_at IS NULL`));
  assert.ok(entry);
  const path = 'admin/shops/' + shopA + '/decisions';
  assert.equal(
    (
      await request(
        path,
        'POST',
        {
          action: 'REQUEST_CHANGES',
          expectedStatus: 'PENDING_VERIFICATION',
          caseId: entry.id,
        },
        admin,
      )
    ).status,
    400,
  );
  assert.equal(
    (
      await request(
        path,
        'POST',
        {
          action: 'REQUEST_CHANGES',
          expectedStatus: 'PENDING_VERIFICATION',
          caseId: entry.id,
          reason: '<script>x</script>',
        },
        admin,
      )
    ).status,
    400,
  );
  const reason = 'Уточните номер павильона';
  assert.equal(
    (
      await request(
        path,
        'POST',
        {
          action: 'REQUEST_CHANGES',
          expectedStatus: 'PENDING_VERIFICATION',
          caseId: entry.id,
          reason,
        },
        admin,
      )
    ).status,
    200,
  );
  assert.ok(
    (
      await (
        await request(
          'shops/' + shopA + '/verification',
          'GET',
          undefined,
          seller,
          true,
        )
      ).text()
    ).includes(reason),
  );
  assert.equal(
    (
      await request(
        'shops/' + shopA + '/verification',
        'GET',
        undefined,
        other,
        true,
      )
    ).status,
    404,
  );
  assert.equal(
    (
      await request(
        'shops/' + shopA,
        'PATCH',
        { name: 'Corrected fixture ' + run },
        seller,
        true,
      )
    ).status,
    200,
  );
  const caseId = await submitShop();
  assert.equal(
    (
      await request(
        path,
        'POST',
        {
          action: 'REJECT',
          expectedStatus: 'PENDING_VERIFICATION',
          caseId,
          reason: 'Не удалось подтвердить магазин',
        },
        admin,
      )
    ).status,
    200,
  );
  [entry] = await db.client
    .select()
    .from(moderationCases)
    .where(eq(moderationCases.id, caseId));
  assert.ok(entry?.closedAt);
});
void test('approval is atomic, stays VERIFIED and stale/conflicting decisions are rejected', async () => {
  const caseId = await submitShop();
  const data = {
    action: 'APPROVE',
    expectedStatus: 'PENDING_VERIFICATION',
    caseId,
  };
  const responses = await Promise.all([
    request('admin/shops/' + shopA + '/decisions', 'POST', data, admin),
    request('admin/shops/' + shopA + '/decisions', 'POST', data, admin),
  ]);
  assert.deepEqual(responses.map((r) => r.status).sort(), [200, 409]);
  const [shop] = await db.client
    .select()
    .from(shops)
    .where(eq(shops.id, shopA));
  assert.equal(shop?.status, 'VERIFIED');
  const events = await db.client
    .select()
    .from(auditLogs)
    .where(
      and(eq(auditLogs.resourceId, shopA), eq(auditLogs.action, 'APPROVE')),
    );
  assert.ok(events.some((e) => e.result === 'SUCCESS'));
  assert.ok(events.some((e) => e.result === 'FAILED'));
  assert.ok(
    events
      .filter((e) => e.result === 'SUCCESS')
      .every((e) => e.actor === 'USER:' + adminId),
  );
  assert.ok(
    events.some((e) => e.result === 'FAILED' && e.actor === 'USER:' + readerId),
  );
  assert.ok(
    events.every((e) =>
      ['USER:' + adminId, 'USER:' + readerId].includes(e.actor),
    ),
  );
  assert.equal((await request('public/shops/' + shop?.slug)).status, 404);
});
void test('suspension hides ACTIVE shop immediately; self-moderation is forbidden', async () => {
  await paidFixtures(db, [shopA]);
  // Simulates an existing legitimately ACTIVE shop; no activation endpoint is introduced.
  await db.client
    .update(shops)
    .set({ status: 'ACTIVE' })
    .where(eq(shops.id, shopA));
  const [entry] = await db.client
    .select()
    .from(moderationCases)
    .where(eq(moderationCases.shopId, shopA))
    .orderBy(sql`created_at DESC`)
    .limit(1);
  assert.ok(entry);
  const data = {
    action: 'SUSPEND',
    expectedStatus: 'ACTIVE',
    caseId: entry.id,
    reason: 'Проверка обращения о магазине',
  };
  assert.equal(
    (await request('admin/shops/' + shopA + '/decisions', 'POST', data, reader))
      .status,
    403,
  );
  await db.client
    .insert(shopMembers)
    .values({ shopId: shopA, userId: adminId, role: 'SHOP_MANAGER' });
  assert.equal(
    (await request('admin/shops/' + shopA + '/decisions', 'POST', data, admin))
      .status,
    403,
  );
  await db.client
    .delete(shopMembers)
    .where(and(eq(shopMembers.shopId, shopA), eq(shopMembers.userId, adminId)));
  assert.equal(
    (await request('admin/shops/' + shopA + '/decisions', 'POST', data, admin))
      .status,
    200,
  );
  const [shop] = await db.client
    .select()
    .from(shops)
    .where(eq(shops.id, shopA));
  assert.equal(shop?.status, 'SUSPENDED');
  assert.equal((await request('public/shops/' + shop?.slug)).status, 404);
});
void test('audit/history cannot be edited, deleted or truncated, and no HTTP delete exists', async () => {
  const [event] = await db.client
    .select()
    .from(auditLogs)
    .where(eq(auditLogs.resourceId, shopA));
  assert.ok(event);
  await assert.rejects(
    db.client
      .update(auditLogs)
      .set({ result: 'DENIED' })
      .where(eq(auditLogs.id, event.id)),
  );
  await assert.rejects(
    db.client.delete(auditLogs).where(eq(auditLogs.id, event.id)),
  );
  await assert.rejects(db.client.execute(sql`TRUNCATE audit_logs`));
  await assert.rejects(
    db.client
      .delete(moderationHistory)
      .where(eq(moderationHistory.shopId, shopA)),
  );
  await assert.rejects(db.client.execute(sql`TRUNCATE moderation_history`));
  assert.equal(
    (await request('admin/audit/' + event.id, 'DELETE', {}, admin)).status,
    404,
  );
  const text = await (
    await request('admin/audit', 'GET', undefined, admin)
  ).text();
  for (const secret of [
    password,
    totpSecret,
    key.toString('base64'),
    admin.token,
  ])
    assert.ok(!text.includes(secret));
});
void test('admin session rotation, idle expiry and account revocation are enforced on every request', async () => {
  const old = admin;
  const r = await request('admin/auth/rotate', 'POST', {}, admin);
  assert.equal(r.status, 200);
  admin = {
    token: r.headers
      .get('set-cookie')!
      .split(';')[0]!
      .slice('qrg_admin='.length),
    csrfToken: ((await r.json()) as { csrfToken: string }).csrfToken,
  };
  assert.equal(
    (await request('admin/auth/me', 'GET', undefined, old)).status,
    401,
  );
  assert.equal(
    (await request('admin/auth/me', 'GET', undefined, admin)).status,
    200,
  );
  await db.client
    .update(adminSessions)
    .set({ lastSeenAt: new Date(Date.now() - 16 * 60000) })
    .where(eq(adminSessions.tokenHash, tokenHash(admin.token)));
  assert.equal(
    (await request('admin/auth/me', 'GET', undefined, admin)).status,
    401,
  );
  admin = await freshSession(adminId);
  await db.client
    .update(adminSessions)
    .set({
      createdAt: new Date(Date.now() - 2 * 60 * 60000),
      expiresAt: new Date(Date.now() - 60 * 60000),
    })
    .where(eq(adminSessions.tokenHash, tokenHash(admin.token)));
  assert.equal(
    (await request('admin/auth/me', 'GET', undefined, admin)).status,
    401,
  );
  admin = await freshSession(adminId);
  await db.client
    .update(adminAccounts)
    .set({ enabled: false })
    .where(eq(adminAccounts.userId, adminId));
  assert.equal(
    (await request('admin/dashboard', 'GET', undefined, admin)).status,
    401,
  );
  await db.client
    .update(adminAccounts)
    .set({ enabled: true })
    .where(eq(adminAccounts.userId, adminId));
});
void test('password reset/revoke-all also revokes admin sessions; logout invalidates token', async () => {
  admin = await freshSession(adminId);
  const auth = app.get(AuthService);
  const account = await auth.login(emails[2]!, password);
  await auth.revokeAll(await auth.authenticate(account.token));
  assert.equal(
    (await request('admin/auth/me', 'GET', undefined, admin)).status,
    401,
  );
  admin = await freshSession(adminId);
  assert.equal(
    (await request('admin/auth/logout', 'POST', {}, admin)).status,
    204,
  );
  assert.equal(
    (await request('admin/auth/me', 'GET', undefined, admin)).status,
    401,
  );
});
void test('MFA brute force is throttled and forwarded headers cannot reset the bucket', async () => {
  for (let i = 0; i < 5; i++)
    assert.equal(
      (
        await request('admin/auth/login', 'POST', {
          email: emails[3],
          password,
          code: '000000',
        })
      ).status,
      401,
    );
  const r = await request(
    'admin/auth/login',
    'POST',
    { email: emails[3], password, code: '000000' },
    undefined,
    false,
    { 'x-forwarded-for': '8.8.8.8' },
  );
  assert.equal(r.status, 429);
  assert.equal(r.headers.get('retry-after'), '900');
});
void test('bounded admin session cleanup preserves current sessions and immutable audit', async () => {
  const marker = new Error('rollback cleanup fixture');
  await assert.rejects(
    db.client.transaction(async (tx) => {
      const [stale] = await tx
        .insert(adminSessions)
        .values({
          userId: adminId,
          tokenHash: tokenHash(newToken()),
          createdAt: new Date(Date.now() - 32 * 86400000),
          expiresAt: new Date(Date.now() - 32 * 86400000 + 3600000),
        })
        .returning();
      const [active] = await tx
        .insert(adminSessions)
        .values({
          userId: adminId,
          tokenHash: tokenHash(newToken()),
          expiresAt: sql`now() + interval '1 hour'`,
        })
        .returning();
      assert.ok(stale && active);
      const [countBefore] = await tx
        .select({ count: sql<number>`count(*)::integer` })
        .from(auditLogs);
      assert.ok((await cleanupExpired(tx)).adminSessions >= 1);
      assert.equal(
        (
          await tx
            .select()
            .from(adminSessions)
            .where(eq(adminSessions.id, stale.id))
        ).length,
        0,
      );
      assert.equal(
        (
          await tx
            .select()
            .from(adminSessions)
            .where(eq(adminSessions.id, active.id))
        ).length,
        1,
      );
      const [countAfter] = await tx
        .select({ count: sql<number>`count(*)::integer` })
        .from(auditLogs);
      assert.deepEqual(countAfter, countBefore);
      throw marker;
    }),
    (error: unknown) => error === marker,
  );
});
void test('operator CLI requires enrollment proof, grants explicit permissions and revokes access with audit', async () => {
  const secret = new Secret({ size: 20 }).base32;
  async function provision(action: string, code: string) {
    const child = spawn(
      process.execPath,
      ['.test-dist/src/admin/provision-main.js'],
      {
        stdio: 'pipe',
        env: {
          ...process.env,
          NODE_ENV: 'test',
          ADMIN_PROVISION_USER_ID: readerId,
          ADMIN_PROVISION_OPERATOR: 'test-operator',
          ADMIN_PROVISION_ACTION: action,
          ADMIN_PROVISION_TOTP_SECRET: secret,
          ADMIN_PROVISION_TOTP_CODE: code,
          ADMIN_PROVISION_MODERATE: 'true',
          ADMIN_PROVISION_SUSPEND: 'false',
          ADMIN_PROVISION_AUDIT: 'false',
        },
      },
    );
    let output = '';
    child.stdout.on('data', (data: Buffer) => {
      output += data.toString();
    });
    child.stderr.on('data', (data: Buffer) => {
      output += data.toString();
    });
    await once(child, 'close');
    for (const value of [secret, key.toString('base64'), password])
      assert.ok(!output.includes(value));
    return child.exitCode;
  }
  assert.equal(await provision('grant', 'invalid'), 1);
  assert.equal(await provision('grant', new TOTP({ secret }).generate()), 0);
  const [account] = await db.client
    .select()
    .from(adminAccounts)
    .where(eq(adminAccounts.userId, readerId));
  assert.ok(
    account?.enabled &&
      account.canModerate &&
      !account.canSuspend &&
      !account.canReadAudit,
  );
  assert.ok(account.totpEncrypted);
  assert.ok(!account.totpEncrypted.includes(secret));
  reader = await freshSession(readerId);
  assert.equal(await provision('revoke', ''), 0);
  assert.equal(
    (await request('admin/auth/me', 'GET', undefined, reader)).status,
    401,
  );
  const events = await db.client
    .select()
    .from(auditLogs)
    .where(
      and(
        eq(auditLogs.resourceId, readerId),
        eq(auditLogs.actor, 'OPERATOR:test-operator'),
      ),
    );
  assert.ok(
    events.some(
      (e) => e.action === 'ADMIN_PROVISION' && e.result === 'SUCCESS',
    ),
  );
  assert.ok(
    events.some((e) => e.action === 'ADMIN_REVOKE' && e.result === 'SUCCESS'),
  );
});
if (process.env.QRG_TEST_BUILT_ADMIN === 'true')
  void test('built Admin Area isolates BFF cookies/routes and renders real queue, history and audit', async () => {
    admin = await freshSession(adminId);
    const requireWeb = createRequire(resolve('../web/package.json'));
    const child = spawn(
      process.execPath,
      [
        requireWeb.resolve('next/dist/bin/next'),
        'start',
        '-p',
        '43187',
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
        if (child.exitCode !== null) throw new Error('Built web exited');
        try {
          ready = (await fetch(config.appOrigin + '/admin/login')).ok;
          if (ready) break;
        } catch {
          /* bounded startup retry */
        }
        await new Promise((r) => setTimeout(r, 100));
      }
      assert.ok(ready);
      const h = { cookie: 'qrg_admin=' + admin.token };
      const blocked = await fetch(config.appOrigin + '/admin', {
        headers: { cookie: 'qrg_session=' + seller.token },
        redirect: 'manual',
      });
      assert.equal(blocked.status, 307);
      assert.match(blocked.headers.get('location') ?? '', /\/admin\/login$/);
      for (const path of [
        '/admin',
        '/admin/shops?status=SUSPENDED',
        '/admin/shops/' + shopA,
        '/admin/shops/' + shopB,
        '/admin/audit',
      ]) {
        const r = await fetch(config.appOrigin + path, { headers: h });
        assert.equal(r.status, 200, path);
        assert.match(await r.text(), /noindex/);
      }
      const detail = await (
        await fetch(config.appOrigin + '/admin/shops/' + shopA, { headers: h })
      ).text();
      assert.ok(detail.includes('Уточните номер павильона'));
      assert.ok(detail.includes('История модерации'));
      assert.equal(
        (
          await fetch(config.appOrigin + '/api/admin/dashboard', {
            headers: { cookie: 'qrg_session=' + seller.token },
          })
        ).status,
        401,
      );
      assert.equal(
        (
          await fetch(config.appOrigin + '/api/admin/audit', {
            method: 'DELETE',
            headers: h,
          })
        ).status,
        404,
      );
      const r = await fetch(
        config.appOrigin + '/api/admin/shops/' + shopA + '/decisions',
        {
          method: 'POST',
          headers: {
            ...h,
            origin: config.appOrigin,
            'content-type': 'application/json',
            'x-qrg-client': 'web',
            'x-qrg-csrf': admin.csrfToken,
          },
          body: JSON.stringify({
            action: 'REQUEST_CHANGES',
            expectedStatus: 'SUSPENDED',
            caseId: (
              await db.client
                .select()
                .from(moderationCases)
                .where(eq(moderationCases.shopId, shopA))
                .orderBy(sql`created_at DESC`)
                .limit(1)
            )[0]!.id,
            reason: 'Обновите контакты магазина',
          }),
        },
      );
      assert.equal(r.status, 200);
      const sellerPage = await fetch(
        config.appOrigin + '/seller/' + shopA + '/shop',
        { headers: { cookie: 'qrg_session=' + seller.token } },
      );
      assert.equal(sellerPage.status, 200);
      assert.ok(
        (await sellerPage.text()).includes('Обновите контакты магазина'),
      );
    } finally {
      if (child.exitCode === null) {
        const exited = once(child, 'exit');
        child.kill();
        await exited;
      }
    }
  });
