import 'reflect-metadata';
import { before, after, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import { Test } from '@nestjs/testing';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { TOTP } from 'otpauth';
import { and, eq, inArray, sql } from 'drizzle-orm';
import { AppModule } from '../src/app.module.js';
import { Database } from '../src/database.js';
import { loadConfig } from '../src/config.js';
import { configureApplication } from '../src/http.js';
import { runMigrations } from '../src/db/migrate.js';
import {
  adminAccounts,
  adminSessions,
  auditLogs,
  categories,
  productDrafts,
  products,
  shops,
  shopMembers,
  users,
} from '../src/db/schema.js';
import { bootstrapAdmin } from '../src/admin/bootstrap.js';
import { AuthService } from '../src/auth/service.js';
import { ShopsService } from '../src/shops/service.js';
import { newToken, tokenHash, csrfFor } from '../src/auth/tokens.js';
void describe(
  'PHASE 8B real database admin control security',
  { concurrency: false },
  () => {
    const run = randomUUID(),
      password = 'Bootstrap test temporary password!',
      changed = 'Changed integration password 2026!';
    const email = run + '-bootstrap@example.test',
      sellerEmail = run + '-seller@example.test',
      limitedEmail = run + '-limited@example.test';
    const config = loadConfig({
      ...process.env,
      NODE_ENV: 'test',
      AUTH_RATE_LIMIT_SECRET: run + '-admin-control',
    });
    assert.ok(new URL(config.databaseUrl).pathname.endsWith('_test'));
    const previousKey = process.env.ADMIN_MFA_ENCRYPTION_KEY;
    let app: NestExpressApplication,
      db: Database,
      base: string,
      adminId: string,
      limitedId: string,
      sellerId: string,
      shopId: string,
      categoryId: string,
      productId: string;
    type Client = { token: string; csrfToken: string };
    let admin: Client, seller: Client, limited: Client;
    let recovery: string[] = [];
    async function request(
      path: string,
      method = 'GET',
      body?: unknown,
      client?: Client,
      sellerCookie = false,
      headers: Record<string, string> = {},
    ) {
      return fetch(base + '/api/v1/' + path, {
        method,
        headers: {
          origin: config.appOrigin,
          'content-type': 'application/json',
          'x-qrg-client': 'web',
          ...(client
            ? {
                cookie:
                  (sellerCookie ? 'qrg_session=' : 'qrg_admin=') + client.token,
                'x-qrg-csrf': client.csrfToken,
              }
            : {}),
          ...headers,
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
    }
    async function login(pass: string, code = '') {
      const response = await request('admin/auth/login', 'POST', {
        email,
        password: pass,
        code,
      });
      assert.equal(response.status, 200);
      const token = /qrg_admin=([A-Za-z0-9_-]{43})/.exec(
        response.headers.get('set-cookie') ?? '',
      )?.[1];
      assert.ok(token);
      return { token, csrfToken: csrfFor(token) };
    }
    async function fixtureSession(userId: string): Promise<Client> {
      // Only test fixtures bypass login for independently testing permission/revocation boundaries.
      const token = newToken();
      await db.client.insert(adminSessions).values({
        userId,
        tokenHash: tokenHash(token),
        expiresAt: sql`now() + interval '1 hour'`,
      });
      return { token, csrfToken: csrfFor(token) };
    }
    before(async () => {
      process.env.ADMIN_MFA_ENCRYPTION_KEY = randomBytes(32).toString('base64');
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
      const auth = app.get(AuthService);
      await auth.signup(sellerEmail, password);
      const signed = await auth.login(sellerEmail, password);
      seller = signed;
      const principal = await auth.authenticate(signed.token);
      sellerId = principal.userId;
      shopId = (
        await app.get(ShopsService).create(principal, 'Control test shop')
      ).id;
      const [category] = await db.client
        .insert(categories)
        .values({ name: 'Control test category', slug: 'control-' + run })
        .returning();
      categoryId = category!.id;
      const response = await request(
        'shops/' + shopId + '/products',
        'POST',
        {
          name: 'Product <script>alert(1)</script>',
          slug: 'control-product-' + run,
          categoryId,
          basePrice: 100,
          status: 'PUBLISHED',
          variants: [{ available: true }],
        },
        seller,
        true,
      );
      assert.equal(response.status, 201);
      productId = ((await response.json()) as { id: string }).id;
    });
    after(async () => {
      if (db) {
        if (shopId) {
          await db.client
            .delete(productDrafts)
            .where(eq(productDrafts.shopId, shopId));
          await db.client.delete(shops).where(eq(shops.id, shopId));
        }
        await db.client
          .delete(users)
          .where(inArray(users.email, [email, sellerEmail, limitedEmail]));
        if (categoryId)
          await db.client
            .delete(categories)
            .where(eq(categories.id, categoryId));
      }
      await app?.close();
      if (previousKey === undefined)
        delete process.env.ADMIN_MFA_ENCRYPTION_KEY;
      else process.env.ADMIN_MFA_ENCRYPTION_KEY = previousKey;
    });
    void test('bootstrap is concurrent idempotent and never overwrites password', async () => {
      const results = await Promise.all([
        bootstrapAdmin(db, email, password),
        bootstrapAdmin(db, email, password),
      ]);
      assert.equal(results.filter((r) => r.created).length, 1);
      assert.equal(results[0].userId, results[1].userId);
      adminId = results[0].userId;
      const [before] = await db.client
        .select()
        .from(users)
        .where(eq(users.id, adminId));
      assert.ok(before!.passwordHash.startsWith('$argon2id$'));
      await bootstrapAdmin(db, email, 'Another unused test password!');
      const [after] = await db.client
        .select()
        .from(users)
        .where(eq(users.id, adminId));
      assert.equal(before!.passwordHash, after!.passwordHash);
    });
    void test('temporary password session cannot enter control center or enroll before changing password', async () => {
      admin = await login(password);
      assert.equal(
        (await request('admin/overview', 'GET', undefined, admin)).status,
        403,
      );
      assert.equal(
        (await request('admin/administrators', 'GET', undefined, admin)).status,
        403,
      );
      assert.equal(
        (await request('admin/auth/mfa/setup', 'POST', {}, admin)).status,
        409,
      );
      const changedResponse = await request(
        'admin/auth/password',
        'POST',
        { currentPassword: password, newPassword: changed },
        admin,
      );
      assert.equal(changedResponse.status, 201);
      assert.equal(
        (await request('admin/auth/me', 'GET', undefined, admin)).status,
        401,
      );
      assert.equal(
        (
          await request('admin/auth/login', 'POST', {
            email,
            password,
            code: '',
          })
        ).status,
        401,
      );
      admin = await login(changed);
    });
    void test('TOTP enrollment is verified, secrets encrypted and recovery codes hashed; enrolled setup cannot be reopened', async () => {
      const response = await request('admin/auth/mfa/setup', 'POST', {}, admin);
      assert.equal(response.status, 201);
      const setup = (await response.json()) as { secret: string; uri: string };
      assert.ok(setup.uri.startsWith('otpauth://totp/'));
      const verify = await request(
        'admin/auth/mfa/verify',
        'POST',
        { code: new TOTP({ secret: setup.secret }).generate() },
        admin,
      );
      assert.equal(verify.status, 201);
      recovery = ((await verify.json()) as { recoveryCodes: string[] })
        .recoveryCodes;
      assert.equal(recovery.length, 10);
      const [account] = await db.client
        .select()
        .from(adminAccounts)
        .where(eq(adminAccounts.userId, adminId));
      assert.ok(account!.totpEncrypted);
      assert.ok(!account!.totpEncrypted.includes(setup.secret));
      assert.equal(account!.pendingTotpEncrypted, null);
      assert.ok(!JSON.stringify(account).includes(recovery[0]!));
      admin = await login(changed, recovery[0]);
      assert.equal(
        (await request('admin/overview', 'GET', undefined, admin)).status,
        200,
      );
      assert.equal(
        (await request('admin/auth/mfa/setup', 'POST', {}, admin)).status,
        409,
      );
    });
    void test('seller roles, cookie substitution and mass assignment never grant admin access', async () => {
      for (const role of [
        'SHOP_OWNER',
        'SHOP_MANAGER',
        'SHOP_EMPLOYEE',
      ] as const) {
        await db.client
          .update(shopMembers)
          .set({ role })
          .where(eq(shopMembers.userId, sellerId));
        assert.equal(
          (await request('admin/overview', 'GET', undefined, seller, true))
            .status,
          401,
        );
        assert.equal(
          (await request('admin/overview', 'GET', undefined, seller)).status,
          401,
        );
      }
      await db.client
        .update(shopMembers)
        .set({ role: 'SHOP_OWNER' })
        .where(eq(shopMembers.userId, sellerId));
      assert.equal(
        (
          await request(
            'shops/' + shopId,
            'PATCH',
            { name: 'Changed', role: 'SUPER_ADMIN', isAdmin: true },
            seller,
            true,
          )
        ).status,
        400,
      );
    });
    void test('CSRF and unsafe role values are rejected before state changes', async () => {
      assert.equal(
        (
          await request(
            'admin/users/' + sellerId + '/actions',
            'POST',
            { action: 'DISABLE', reason: 'Test reason' },
            admin,
            false,
            { 'x-qrg-csrf': 'invalid' },
          )
        ).status,
        403,
      );
      assert.equal(
        (
          await request(
            'admin/administrators',
            'POST',
            {
              email: limitedEmail,
              temporaryPassword: password,
              role: 'super_owner_everything',
              reason: 'Test reason',
            },
            admin,
          )
        ).status,
        400,
      );
      assert.equal(
        (
          await request(
            'admin/users/' + sellerId + '/actions',
            'POST',
            { action: 'ENABLE', reason: 'Test reason', paymentStatus: 'PAID' },
            admin,
          )
        ).status,
        400,
      );
    });
    void test('critical user action creates request-correlated audit and revokes seller session', async () => {
      const response = await request(
        'admin/users/' + sellerId + '/actions',
        'POST',
        { action: 'REVOKE_SESSIONS', reason: 'Security test session revoke' },
        admin,
      );
      assert.equal(response.status, 201);
      const [event] = await db.client
        .select()
        .from(auditLogs)
        .where(
          and(
            eq(auditLogs.resourceId, sellerId),
            eq(auditLogs.action, 'SESSION_REVOKED'),
          ),
        )
        .orderBy(sql`created_at DESC`)
        .limit(1);
      assert.equal(event!.reason, 'Security test session revoke');
      assert.equal(event!.requestId, response.headers.get('x-request-id'));
      assert.equal(
        (await request('auth/me', 'GET', undefined, seller, true)).status,
        401,
      );
      seller = await app.get(AuthService).login(sellerEmail, password);
    });
    void test('product moderation cannot be undone through seller update, bulk or copy', async () => {
      assert.equal(
        (
          await request(
            'admin/products/' + productId + '/moderation',
            'POST',
            { action: 'HIDE', reason: 'Moderation test reason' },
            admin,
          )
        ).status,
        201,
      );
      assert.equal(
        (
          await request(
            'shops/' + shopId + '/product-actions',
            'POST',
            { ids: [productId], action: 'PUBLISH' },
            seller,
            true,
          )
        ).status,
        409,
      );
      assert.equal(
        (
          await request(
            'shops/' + shopId + '/products/' + productId,
            'PUT',
            {
              name: 'Seller override',
              slug: 'control-product-' + run,
              categoryId,
              basePrice: 100,
              status: 'PUBLISHED',
            },
            seller,
            true,
          )
        ).status,
        409,
      );
      const duplicate = await request(
        'shops/' + shopId + '/products/' + productId + '/duplicate',
        'POST',
        {},
        seller,
        true,
      );
      assert.equal(duplicate.status, 201);
      const copy = (await duplicate.json()) as { id: string };
      const [product] = await db.client
        .select()
        .from(products)
        .where(eq(products.id, copy.id));
      assert.equal(product!.moderationHidden, true);
      assert.equal(
        (
          await request(
            'admin/products/' + productId + '/moderation',
            'POST',
            { action: 'RESTORE', reason: 'Issue fixed in fixture' },
            admin,
          )
        ).status,
        201,
      );
    });
    void test('admin list/detail responses never return credential or payment secrets', async () => {
      for (const path of [
        'admin/auth/me',
        'admin/users',
        'admin/users/' + sellerId,
        'admin/administrators',
        'admin/products',
        'admin/subscriptions',
      ]) {
        const response = await request(path, 'GET', undefined, admin);
        assert.equal(response.status, 200);
        const body = await response.text();
        assert.ok(
          !/"(?:passwordHash|tokenHash|totpEncrypted|pendingTotpEncrypted|recoveryHashes|merchantSecret|password)"/.test(
            body,
          ),
        );
      }
      assert.equal(
        (await request('admin/audit/' + randomUUID(), 'DELETE', {}, admin))
          .status,
        404,
      );
    });
    void test('limited admin cannot invoke super actions and loses access on deactivation', async () => {
      const response = await request(
        'admin/administrators',
        'POST',
        {
          email: limitedEmail,
          temporaryPassword: password,
          role: 'SUPPORT_ADMIN',
          reason: 'Create test support admin',
        },
        admin,
      );
      assert.equal(response.status, 201);
      limitedId = ((await response.json()) as { id: string }).id;
      const [source] = await db.client
        .select()
        .from(adminAccounts)
        .where(eq(adminAccounts.userId, adminId));
      // Permission fixture only: encrypted value is not used for login of this account.
      await db.client
        .update(adminAccounts)
        .set({
          mustChangePassword: false,
          totpEncrypted: source!.totpEncrypted,
        })
        .where(eq(adminAccounts.userId, limitedId));
      limited = await fixtureSession(limitedId);
      assert.equal(
        (await request('admin/users', 'GET', undefined, limited)).status,
        200,
      );
      assert.equal(
        (await request('admin/administrators', 'GET', undefined, limited))
          .status,
        403,
      );
      assert.equal(
        (
          await request(
            'admin/users/' + sellerId + '/actions',
            'POST',
            { action: 'DISABLE', reason: 'Not allowed' },
            limited,
          )
        ).status,
        403,
      );
      assert.equal(
        (
          await request(
            'admin/administrators/' + limitedId + '/actions',
            'POST',
            { action: 'DEACTIVATE', reason: 'End fixture access' },
            admin,
          )
        ).status,
        201,
      );
      assert.equal(
        (await request('admin/auth/me', 'GET', undefined, limited)).status,
        401,
      );
    });
    void test('last active super administrator cannot be disabled or demoted', async () => {
      for (const body of [
        { action: 'DEACTIVATE', reason: 'Must fail' },
        { action: 'CHANGE_ROLE', role: 'SUPPORT_ADMIN', reason: 'Must fail' },
      ])
        assert.equal(
          (
            await request(
              'admin/administrators/' + adminId + '/actions',
              'POST',
              body,
              admin,
            )
          ).status,
          409,
        );
      assert.equal(
        (
          await request(
            'admin/users/' + adminId + '/actions',
            'POST',
            { action: 'DISABLE', reason: 'Must fail' },
            admin,
          )
        ).status,
        409,
      );
    });
    void test('admin session revocation and bootstrap rerun preserve changed password', async () => {
      await bootstrapAdmin(db, email, password);
      const before = admin;
      assert.equal(
        (
          await request(
            'admin/administrators/' + adminId + '/actions',
            'POST',
            { action: 'REVOKE_SESSIONS', reason: 'Revoke fixture sessions' },
            admin,
          )
        ).status,
        201,
      );
      assert.equal(
        (await request('admin/auth/me', 'GET', undefined, before)).status,
        401,
      );
      admin = await fixtureSession(adminId);
      const loginAgain = await request('admin/auth/login', 'POST', {
        email,
        password,
        code: recovery[1],
      });
      assert.ok([401, 429].includes(loginAgain.status));
    });
    void test('admin login brute force reaches the existing rate limit', async () => {
      const attempts: number[] = [];
      for (let i = 0; i < 7; i++)
        attempts.push(
          (
            await request('admin/auth/login', 'POST', {
              email: run + '-missing@example.test',
              password,
              code: '000000',
            })
          ).status,
        );
      assert.ok(attempts.includes(429));
    });
  },
);
