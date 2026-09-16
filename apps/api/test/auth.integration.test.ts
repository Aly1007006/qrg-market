import 'reflect-metadata';
import { createHmac, randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { Test } from '@nestjs/testing';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { and, eq, inArray, isNull, sql } from 'drizzle-orm';
import { AppModule } from '../src/app.module.js';
import { loadConfig } from '../src/config.js';
import { Database } from '../src/database.js';
import { runMigrations } from '../src/db/migrate.js';
import { cleanupExpired } from '../src/db/cleanup.js';
import {
  authRateLimits,
  passwordResetTokens,
  sessions,
  shopMembers,
  shops,
  users,
} from '../src/db/schema.js';
import { configureApplication } from '../src/http.js';
import {
  PasswordResetDelivery,
  type ResetMessage,
} from '../src/auth/delivery.js';
import { Passwords } from '../src/auth/passwords.js';
import { AuthService } from '../src/auth/service.js';
import { AuthRateLimiter } from '../src/auth/rate-limiter.js';
import { ShopsService } from '../src/shops/service.js';
import { newToken, tokenHash } from '../src/auth/tokens.js';

// Only the external delivery transport is substituted. HTTP, Argon2, sessions,
// authorization, transactions and PostgreSQL all run their production code.
class CaptureDelivery extends PasswordResetDelivery {
  enabled = true;
  fail = false;
  messages: ResetMessage[] = [];
  available(): boolean {
    return this.enabled;
  }
  send(message: ResetMessage): Promise<void> {
    this.messages.push(message);
    return this.fail
      ? Promise.reject(new Error('fixture delivery failure'))
      : Promise.resolve();
  }
}
interface Client {
  cookie: string;
  csrfToken: string;
  sessionId: string;
  userId: string;
}
interface LoginBody {
  user: { id: string; email: string };
  sessionId: string;
  csrfToken: string;
  expiresAt: string;
}
interface Shop {
  id: string;
  name: string;
  status: string;
}
interface Member {
  id: string;
  shopId: string;
  userId: string;
  role: string;
}

void describe(
  'PHASE 1 real database authentication and tenant isolation',
  { concurrency: false },
  () => {
    const runId = randomUUID();
    const password = 'Fixture-only correct horse 2026!';
    const config = loadConfig({
      ...process.env,
      NODE_ENV: 'test',
      APP_ORIGIN: 'http://localhost:3000',
      SWAGGER_ENABLED: 'true',
      AUTH_RATE_LIMIT_SECRET: `${runId}-fixture-rate-secret`,
    });
    assert.ok(
      new URL(config.databaseUrl).pathname.endsWith('_test'),
      'Security integration tests require a dedicated *_test database',
    );
    const delivery = new CaptureDelivery();
    const accounts = [
      'a',
      'b',
      'manager',
      'employee',
      'session',
      'reset',
      'reset-race',
      'reset-expired',
    ] as const;
    const email = (name: string) => `phase1-${runId}-${name}@example.test`;
    const fixtureEmails: string[] = [];
    const shopIds: string[] = [];
    const rateKeys = new Set<string>();
    const ids = new Map<string, string>();
    let app: NestExpressApplication;
    let database: Database;
    let auth: AuthService;
    let tenant: ShopsService;
    let limiter: AuthRateLimiter;
    let base: string;
    let ownerA: Client;
    let ownerB: Client;
    let manager: Client;
    let employee: Client;
    let shopA: Shop;
    let shopB: Shop;
    let managerMember: Member;
    let employeeMember: Member;
    let ownerBMember: Member;

    function request(
      path: string,
      method = 'GET',
      client?: Client,
      body?: unknown,
      overrides: Record<string, string> = {},
    ) {
      const headers: Record<string, string> = {
        origin: config.appOrigin,
        'x-qrg-client': 'web',
        'content-type': 'application/json',
      };
      if (client) {
        headers.cookie = client.cookie;
        headers['x-qrg-csrf'] = client.csrfToken;
      }
      const action = (
        {
          '/auth/signup': 'signup',
          '/auth/login': 'login',
          '/auth/password-reset/request': 'reset-request',
          '/auth/password-reset/confirm': 'reset-confirm',
        } as Record<string, string>
      )[path];
      if (action) {
        rateKeys.add(`${action}:ip:127.0.0.1`);
        if (
          body &&
          typeof body === 'object' &&
          'email' in body &&
          typeof body.email === 'string'
        )
          rateKeys.add(
            `${action}:email:${body.email.trim().toLowerCase().slice(0, 254)}`,
          );
      }
      return fetch(`${base}/api/v1${path}`, {
        method,
        headers: { ...headers, ...overrides },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
    }
    async function read<T>(response: Response, status = 200): Promise<T> {
      assert.equal(
        response.status,
        status,
        await (response.status === status
          ? Promise.resolve('')
          : response.clone().text()),
      );
      return (await response.json()) as T;
    }
    async function login(
      name: string,
      loginPassword = password,
      previous?: Client,
    ): Promise<Client> {
      const response = await request('/auth/login', 'POST', previous, {
        email: email(name),
        password: loginPassword,
      });
      const body = await read<LoginBody>(response);
      const cookie = response.headers.get('set-cookie')?.split(';')[0];
      assert.ok(cookie);
      return {
        cookie,
        csrfToken: body.csrfToken,
        sessionId: body.sessionId,
        userId: body.user.id,
      };
    }
    async function createShop(client: Client, name: string): Promise<Shop> {
      const shop = await read<Shop>(
        await request('/shops', 'POST', client, { name }),
        201,
      );
      shopIds.push(shop.id);
      return shop;
    }
    const dbError =
      (code: string) =>
      (error: unknown): boolean => {
        let current = error;
        for (let i = 0; i < 5 && current && typeof current === 'object'; i++) {
          if ('code' in current && current.code === code) return true;
          current = 'cause' in current ? current.cause : undefined;
        }
        return false;
      };

    before(async () => {
      await Promise.all([
        runMigrations(config, resolve('drizzle')),
        runMigrations(config, resolve('drizzle')),
      ]);
      const module = await Test.createTestingModule({
        imports: [AppModule.register(config)],
      })
        .overrideProvider(PasswordResetDelivery)
        .useValue(delivery)
        .compile();
      app = module.createNestApplication<NestExpressApplication>({
        bodyParser: false,
        logger: false,
      });
      await configureApplication(app, config);
      await app.listen(0, '127.0.0.1');
      base = await app.getUrl();
      database = module.get(Database);
      auth = module.get(AuthService);
      tenant = module.get(ShopsService);
      limiter = module.get(AuthRateLimiter);
      const hash = await module.get(Passwords).hash(password);
      for (const name of accounts) {
        fixtureEmails.push(email(name));
        const [user] = await database.client
          .insert(users)
          .values({ email: email(name), passwordHash: hash })
          .returning({ id: users.id });
        assert.ok(user);
        ids.set(name, user.id);
      }
      ownerA = await login('a');
      ownerB = await login('b');
      manager = await login('manager');
      employee = await login('employee');
      shopA = await createShop(ownerA, 'Fixture shop A');
      shopB = await createShop(ownerB, 'Fixture shop B');
      managerMember = await read<Member>(
        await request(`/shops/${shopA.id}/members`, 'POST', ownerA, {
          userId: manager.userId,
          role: 'SHOP_MANAGER',
        }),
        201,
      );
      employeeMember = await read<Member>(
        await request(`/shops/${shopA.id}/members`, 'POST', ownerA, {
          userId: employee.userId,
          role: 'SHOP_EMPLOYEE',
        }),
        201,
      );
      const members = await read<Member[]>(
        await request(`/shops/${shopB.id}/members`, 'GET', ownerB),
      );
      const owner = members.find((m) => m.role === 'SHOP_OWNER');
      assert.ok(owner);
      ownerBMember = owner;
    });
    void test('bounded cleanup removes only expired security records and preserves active sessions', async () => {
      await assert.rejects(
        database.client.transaction(async (tx) => {
          const [stale] = await tx
            .insert(sessions)
            .values({
              userId: ownerA.userId,
              tokenHash: tokenHash(newToken()),
              createdAt: new Date(Date.now() - 61 * 86400000),
              expiresAt: new Date(Date.now() - 31 * 86400000),
            })
            .returning({ id: sessions.id });
          const [reset] = await tx
            .insert(passwordResetTokens)
            .values({
              userId: ownerA.userId,
              tokenHash: tokenHash(newToken()),
              createdAt: new Date(Date.now() - 3 * 86400000),
              expiresAt: new Date(Date.now() - 2 * 86400000),
            })
            .returning({ id: passwordResetTokens.id });
          const key = tokenHash(newToken());
          await tx.insert(authRateLimits).values({
            keyHash: key,
            hits: 1,
            windowEndsAt: new Date(Date.now() - 2 * 86400000),
          });
          assert.ok(stale);
          assert.ok(reset);
          const cleaned = await cleanupExpired(tx);
          assert.ok(
            cleaned.sessions >= 1 &&
              cleaned.resetTokens >= 1 &&
              cleaned.rateBuckets >= 1,
          );
          assert.equal(
            (await tx.select().from(sessions).where(eq(sessions.id, stale.id)))
              .length,
            0,
          );
          assert.equal(
            (
              await tx
                .select()
                .from(passwordResetTokens)
                .where(eq(passwordResetTokens.id, reset.id))
            ).length,
            0,
          );
          assert.equal(
            (
              await tx
                .select()
                .from(authRateLimits)
                .where(eq(authRateLimits.keyHash, key))
            ).length,
            0,
          );
          assert.equal(
            (
              await tx
                .select()
                .from(sessions)
                .where(eq(sessions.id, ownerA.sessionId))
            ).length,
            1,
          );
          // Roll back the entire cleanup test, including any pre-existing expired records.
          throw new Error('fixture cleanup rollback');
        }),
        /fixture cleanup rollback/,
      );
    });
    void test('private lists support bounded pagination and reject injected tenant query parameters', async () => {
      const first = await read<Member[]>(
        await request(
          `/shops/${shopA.id}/members?limit=1&offset=0`,
          'GET',
          ownerA,
        ),
      );
      const second = await read<Member[]>(
        await request(
          `/shops/${shopA.id}/members?limit=1&offset=1`,
          'GET',
          ownerA,
        ),
      );
      assert.equal(first.length, 1);
      assert.equal(second.length, 1);
      assert.notEqual(first[0]?.id, second[0]?.id);
      for (const query of [
        'limit=101',
        'offset=-1',
        `owner_id=${ownerB.userId}`,
        `shop_id=${shopB.id}`,
      ])
        assert.equal(
          (await request(`/shops?${query}`, 'GET', ownerA)).status,
          400,
        );
      assert.equal(
        (
          await request(`/shops/${shopA.id}/members`, 'POST', ownerA, {
            userId: manager.userId,
            role: 'SHOP_MANAGER',
          })
        ).status,
        409,
      );
    });
    after(async () => {
      if (database) {
        // Delete only this run's fixtures. Never truncate shared tables or drop the database.
        if (shopIds.length)
          await database.client.delete(shops).where(inArray(shops.id, shopIds));
        if (fixtureEmails.length)
          await database.client
            .delete(users)
            .where(inArray(users.email, fixtureEmails));
        const hashes = [...rateKeys].map((key) =>
          createHmac('sha256', config.rateLimitSecret)
            .update(key)
            .digest('hex'),
        );
        if (hashes.length)
          await database.client
            .delete(authRateLimits)
            .where(inArray(authRateLimits.keyHash, hashes));
      }
      if (app) await app.close();
    });

    void test('migrations are idempotent and concurrency-safe; DB readiness succeeds', async () => {
      const result = await database.client.execute<{ count: string }>(
        sql`SELECT count(*)::text AS count FROM drizzle.__drizzle_migrations`,
      );
      assert.equal(result.rows[0]?.count, '13');
      assert.equal((await request('/health/ready')).status, 200);
    });
    void test('signup normalizes email, hashes Argon2id, returns identical duplicate response and no session', async () => {
      fixtureEmails.push(email('signup'));
      const body = { email: ` ${email('signup').toUpperCase()} `, password };
      const first = await request('/auth/signup', 'POST', undefined, body);
      const duplicate = await request('/auth/signup', 'POST', undefined, {
        email: email('signup'),
        password: 'Another fixture password!',
      });
      assert.equal(first.headers.get('set-cookie'), null);
      assert.deepEqual(await read(first, 202), await read(duplicate, 202));
      const rows = await database.client
        .select()
        .from(users)
        .where(eq(users.email, email('signup')));
      assert.equal(rows.length, 1);
      assert.ok(rows[0]?.passwordHash.startsWith('$argon2id$v=19$'));
      assert.deepEqual(rows[0]?.passwordHash.split('$')[3]?.split(',').sort(), [
        'm=65536',
        'p=1',
        't=3',
      ]);
      assert.ok(!rows[0]?.passwordHash.includes(password));
      assert.equal(
        (
          await request('/auth/login', 'POST', undefined, {
            email: email('signup'),
            password,
          })
        ).status,
        200,
      );
    });
    void test('signup cannot mass-assign role, owner, shop or permissions; weak/oversized passwords rejected', async () => {
      for (const injected of [
        { role: 'ADMIN' },
        { shop_id: shopB.id },
        { owner_id: ownerB.userId },
        { permissions: ['*'] },
      ]) {
        assert.equal(
          (
            await request('/auth/signup', 'POST', undefined, {
              email: email('bad'),
              password,
              ...injected,
            })
          ).status,
          400,
        );
      }
      for (const value of ['short', 'a'.repeat(129)])
        assert.equal(
          (
            await request('/auth/signup', 'POST', undefined, {
              email: email('weak'),
              password: value,
            })
          ).status,
          400,
        );
      assert.equal(
        (
          await database.client
            .select()
            .from(users)
            .where(eq(users.email, email('bad')))
        ).length,
        0,
      );
    });
    void test('login resists fixation; only token hash is stored and cookie lifetime is bounded', async () => {
      const planted = newToken();
      const response = await request(
        '/auth/login',
        'POST',
        undefined,
        { email: email('session'), password },
        { cookie: `qrg_session=${planted}` },
      );
      const body = await read<LoginBody>(response);
      const header = response.headers.get('set-cookie') ?? '';
      assert.match(header, /HttpOnly/);
      assert.match(header, /SameSite=Lax/);
      assert.match(header, /Max-Age=/);
      assert.match(header, /Expires=/);
      assert.ok(!header.includes('Domain='));
      const raw = header.split(';')[0]?.split('=')[1];
      assert.ok(raw);
      assert.notEqual(raw, planted);
      const [stored] = await database.client
        .select()
        .from(sessions)
        .where(eq(sessions.id, body.sessionId));
      assert.ok(stored);
      assert.equal(stored.tokenHash, tokenHash(raw));
      assert.notEqual(stored.tokenHash, raw);
      assert.ok(
        new Date(body.expiresAt).getTime() <= Date.now() + 7 * 86400000,
      );
      assert.deepEqual(Object.keys(body).sort(), [
        'csrfToken',
        'expiresAt',
        'sessionId',
        'user',
      ]);
    });
    void test('unknown user and wrong password return the same generic login error', async () => {
      const missing = await read<{ code: string; message: string }>(
        await request('/auth/login', 'POST', undefined, {
          email: email('missing'),
          password,
        }),
        401,
      );
      const wrong = await read<{ code: string; message: string }>(
        await request('/auth/login', 'POST', undefined, {
          email: email('session'),
          password: 'wrong fixture password',
        }),
        401,
      );
      assert.equal(missing.code, wrong.code);
      assert.equal(missing.message, wrong.message);
    });
    void test('unauthenticated and bearer/body token access are rejected by default', async () => {
      assert.equal((await request('/shops')).status, 401);
      assert.equal(
        (
          await request(`/shops/${shopA.id}`, 'GET', undefined, undefined, {
            authorization: `Bearer ${ownerA.cookie.split('=')[1] ?? ''}`,
          })
        ).status,
        401,
      );
      assert.equal(
        (
          await request('/shops', 'POST', undefined, {
            name: 'Forged',
            userId: ownerA.userId,
          })
        ).status,
        401,
      );
    });
    void test('trusted Origin, custom header, JSON and session-bound CSRF are mandatory on writes', async () => {
      for (const headers of [
        { origin: 'https://evil.example' },
        { origin: '' },
        { 'x-qrg-client': '' },
        { 'sec-fetch-site': 'cross-site' },
        { 'x-qrg-csrf': '' },
        { 'x-qrg-csrf': ownerB.csrfToken },
      ]) {
        assert.equal(
          (
            await request(
              `/shops/${shopA.id}`,
              'PATCH',
              ownerA,
              { name: 'CSRF attempt' },
              headers,
            )
          ).status,
          403,
        );
      }
      assert.equal(
        (
          await request(
            '/auth/login',
            'POST',
            undefined,
            { email: email('a'), password },
            { origin: 'https://evil.example' },
          )
        ).status,
        403,
      );
      assert.equal(
        (
          await request(
            '/auth/login',
            'POST',
            undefined,
            { email: email('a'), password },
            { 'content-type': 'text/plain' },
          )
        ).status,
        415,
      );
    });
    void test('Seller A cannot open Shop B or mutate it by changing the URL (IDOR/BOLA)', async () => {
      assert.equal(
        (await request(`/shops/${shopB.id}`, 'GET', ownerA)).status,
        404,
      );
      assert.equal(
        (
          await request(`/shops/${shopB.id}`, 'PATCH', ownerA, {
            name: 'Stolen',
          })
        ).status,
        404,
      );
      const listed = await read<Shop[]>(await request('/shops', 'GET', ownerA));
      assert.deepEqual(
        listed.map((s) => s.id),
        [shopA.id],
      );
      assert.equal(
        (await read<Shop>(await request(`/shops/${shopB.id}`, 'GET', ownerB)))
          .name,
        'Fixture shop B',
      );
    });
    void test('shop_id/owner_id/role/permissions/status body injection cannot redirect or publish a shop', async () => {
      for (const injected of [
        { shop_id: shopB.id },
        { shopId: shopB.id },
        { owner_id: ownerB.userId },
        { ownerId: ownerB.userId },
        { role: 'SHOP_OWNER' },
        { permissions: ['*'] },
        { status: 'ACTIVE' },
      ]) {
        assert.equal(
          (
            await request(`/shops/${shopA.id}`, 'PATCH', ownerA, {
              name: 'Injected',
              ...injected,
            })
          ).status,
          400,
        );
      }
      assert.equal(shopA.status, 'DRAFT');
      const owner = await database.client
        .select()
        .from(shopMembers)
        .where(
          and(
            eq(shopMembers.shopId, shopA.id),
            eq(shopMembers.role, 'SHOP_OWNER'),
          ),
        );
      assert.equal(owner[0]?.userId, ownerA.userId);
    });
    void test('changing member_id cannot read/update/delete a member of another shop', async () => {
      const path = `/shops/${shopA.id}/members/${ownerBMember.id}`;
      assert.equal((await request(path, 'GET', ownerA)).status, 404);
      assert.equal(
        (await request(path, 'PATCH', ownerA, { role: 'SHOP_EMPLOYEE' }))
          .status,
        404,
      );
      assert.equal((await request(path, 'DELETE', ownerA, {})).status, 404);
      assert.equal(
        (
          await request(
            `/shops/${shopB.id}/members/${ownerBMember.id}`,
            'GET',
            ownerA,
          )
        ).status,
        404,
      );
      assert.equal(
        (
          await request(`/shops/${shopA.id}/members`, 'POST', ownerA, {
            userId: manager.userId,
            role: 'SHOP_EMPLOYEE',
            shop_id: shopB.id,
          })
        ).status,
        400,
      );
    });
    void test('manager and employee cannot elevate themselves or perform owner operations', async () => {
      for (const client of [manager, employee]) {
        assert.equal(
          (await request(`/shops/${shopA.id}`, 'GET', client)).status,
          200,
        );
        assert.equal(
          (
            await request(
              `/shops/${shopA.id}`,
              'PATCH',
              client,
              { name: 'Escalated' },
              { 'x-role': 'SHOP_OWNER', 'x-owner-id': ownerA.userId },
            )
          ).status,
          403,
        );
        assert.equal(
          (await request(`/shops/${shopA.id}/members`, 'GET', client)).status,
          403,
        );
        assert.equal(
          (
            await request(
              `/shops/${shopA.id}/members/${managerMember.id}`,
              'PATCH',
              client,
              { role: 'SHOP_MANAGER' },
            )
          ).status,
          403,
        );
        assert.equal(
          (
            await request(`/shops/${shopA.id}/members`, 'POST', client, {
              userId: ownerB.userId,
              role: 'SHOP_MANAGER',
            })
          ).status,
          403,
        );
      }
    });
    void test('owner assignment/removal is not available through generic member endpoints', async () => {
      assert.equal(
        (
          await request(
            `/shops/${shopA.id}/members/${managerMember.id}`,
            'PATCH',
            ownerA,
            { role: 'SHOP_OWNER' },
          )
        ).status,
        400,
      );
      assert.equal(
        (
          await request(
            `/shops/${shopB.id}/members/${ownerBMember.id}`,
            'DELETE',
            ownerB,
            {},
          )
        ).status,
        403,
      );
      assert.equal(
        (
          await request(
            `/shops/${shopB.id}/members/${ownerBMember.id}`,
            'PATCH',
            ownerB,
            { role: 'SHOP_EMPLOYEE' },
          )
        ).status,
        403,
      );
    });
    void test('role is scoped to the requested shop, never a global seller role', async () => {
      await read<Member>(
        await request(`/shops/${shopB.id}/members`, 'POST', ownerB, {
          userId: ownerA.userId,
          role: 'SHOP_EMPLOYEE',
        }),
        201,
      );
      assert.equal(
        (await request(`/shops/${shopB.id}`, 'GET', ownerA)).status,
        200,
      );
      assert.equal(
        (
          await request(`/shops/${shopB.id}`, 'PATCH', ownerA, {
            name: 'Global role attack',
          })
        ).status,
        403,
      );
    });
    void test('membership revocation is effective for existing sessions and previously captured principals', async () => {
      const principal = await auth.authenticate(employee.cookie.split('=')[1]);
      assert.equal(
        (
          await request(
            `/shops/${shopA.id}/members/${employeeMember.id}`,
            'DELETE',
            ownerA,
            {},
          )
        ).status,
        204,
      );
      assert.equal(
        (await request(`/shops/${shopA.id}`, 'GET', employee)).status,
        404,
      );
      await assert.rejects(tenant.rename(principal, shopA.id, 'Stale access'), {
        status: 404,
      });
    });
    void test('malformed and SQL-like IDs are rejected before resource access', async () => {
      assert.equal(
        (await request('/shops/not-a-uuid', 'GET', ownerA)).status,
        400,
      );
      assert.equal(
        (
          await request(
            `/shops/${encodeURIComponent("' OR 1=1 --")}`,
            'GET',
            ownerA,
          )
        ).status,
        400,
      );
    });
    void test('session listing/revocation cannot cross user boundaries; logout invalidates token', async () => {
      const client = await login('session');
      const listed = await read<{ id: string }[]>(
        await request('/auth/sessions', 'GET', client),
      );
      assert.ok(listed.every((s) => s.id !== ownerA.sessionId));
      assert.equal(
        (
          await request(
            `/auth/sessions/${ownerA.sessionId}`,
            'DELETE',
            client,
            {},
          )
        ).status,
        404,
      );
      const response = await request('/auth/logout', 'POST', client, {});
      assert.equal(response.status, 204);
      assert.match(
        response.headers.get('set-cookie') ?? '',
        /Expires=Thu, 01 Jan 1970/,
      );
      assert.equal((await request('/auth/me', 'GET', client)).status, 401);
      assert.equal((await request('/auth/me', 'GET', ownerA)).status, 200);
    });
    void test('concurrent session rotation has one winner; old session/CSRF cannot be replayed', async () => {
      const client = await login('session');
      const responses = await Promise.all([
        request('/auth/session/rotate', 'POST', client, {}),
        request('/auth/session/rotate', 'POST', client, {}),
      ]);
      assert.deepEqual(responses.map((r) => r.status).sort(), [200, 401]);
      const winner = responses.find((r) => r.status === 200);
      assert.ok(winner);
      const body = await read<{ csrfToken: string; expiresAt: string }>(winner);
      const cookie = winner.headers.get('set-cookie')?.split(';')[0];
      assert.ok(cookie);
      const rotated = { ...client, cookie, csrfToken: body.csrfToken };
      assert.notEqual(body.csrfToken, client.csrfToken);
      assert.equal((await request('/auth/me', 'GET', client)).status, 401);
      assert.equal((await request('/auth/me', 'GET', rotated)).status, 200);
      assert.equal(
        (
          await request(
            '/auth/logout',
            'POST',
            rotated,
            {},
            { 'x-qrg-csrf': client.csrfToken },
          )
        ).status,
        403,
      );
    });
    void test('revoke-all invalidates every session and transaction revalidation rejects a stale principal', async () => {
      const first = await login('session');
      const second = await login('session');
      const principal = await auth.authenticate(second.cookie.split('=')[1]);
      assert.equal(
        (await request('/auth/sessions/revoke-all', 'POST', first, {})).status,
        204,
      );
      assert.equal((await request('/auth/me', 'GET', first)).status, 401);
      assert.equal((await request('/auth/me', 'GET', second)).status, 401);
      await assert.rejects(tenant.create(principal, 'After revoke'), {
        status: 401,
      });
    });
    void test('expired sessions and disabled accounts are rejected even with valid token/CSRF', async () => {
      const client = await login('reset-expired');
      await database.client
        .update(sessions)
        .set({
          createdAt: new Date(Date.now() - 8 * 86400000),
          expiresAt: new Date(Date.now() - 86400000),
        })
        .where(eq(sessions.id, client.sessionId));
      assert.equal((await request('/auth/me', 'GET', client)).status, 401);
      await database.client
        .update(users)
        .set({ disabledAt: new Date() })
        .where(eq(users.id, manager.userId));
      assert.equal((await request('/auth/me', 'GET', manager)).status, 401);
      assert.equal(
        (
          await request('/auth/login', 'POST', undefined, {
            email: email('manager'),
            password,
          })
        ).status,
        401,
      );
      await database.client
        .update(users)
        .set({ disabledAt: null })
        .where(eq(users.id, manager.userId));
    });
    void test('reset delivery disabled returns 503 for both existing and absent addresses', async () => {
      delivery.enabled = false;
      try {
        assert.equal(
          (
            await request('/auth/password-reset/request', 'POST', undefined, {
              email: email('reset'),
            })
          ).status,
          503,
        );
        assert.equal(
          (
            await request('/auth/password-reset/request', 'POST', undefined, {
              email: email('missing-reset'),
            })
          ).status,
          503,
        );
      } finally {
        delivery.enabled = true;
      }
    });
    void test('reset uses hashed expiring token, generic response, one-time consume and revokes all sessions', async () => {
      const old = await login('reset');
      const response = await request(
        '/auth/password-reset/request',
        'POST',
        undefined,
        { email: email('reset') },
      );
      const absent = await request(
        '/auth/password-reset/request',
        'POST',
        undefined,
        { email: email('missing-reset') },
      );
      assert.deepEqual(await read(response, 202), await read(absent, 202));
      const message = delivery.messages.at(-1);
      assert.ok(message);
      const [stored] = await database.client
        .select()
        .from(passwordResetTokens)
        .where(eq(passwordResetTokens.userId, old.userId));
      assert.ok(stored);
      assert.equal(stored.tokenHash, tokenHash(message.token));
      assert.ok(stored.expiresAt.getTime() <= Date.now() + 30 * 60000);
      assert.equal(
        (
          await request('/auth/password-reset/confirm', 'POST', undefined, {
            token: message.token,
            password: 'Changed fixture passphrase!',
          })
        ).status,
        204,
      );
      assert.equal(
        (
          await request('/auth/password-reset/confirm', 'POST', undefined, {
            token: message.token,
            password,
          })
        ).status,
        400,
      );
      assert.equal((await request('/auth/me', 'GET', old)).status, 401);
      assert.equal(
        (
          await request('/auth/login', 'POST', undefined, {
            email: email('reset'),
            password,
          })
        ).status,
        401,
      );
      assert.ok(await login('reset', 'Changed fixture passphrase!'));
    });
    void test('concurrent password resets cannot reuse one token', async () => {
      await read(
        await request('/auth/password-reset/request', 'POST', undefined, {
          email: email('reset-race'),
        }),
        202,
      );
      const message = delivery.messages.at(-1);
      assert.ok(message);
      const responses = await Promise.all([
        request('/auth/password-reset/confirm', 'POST', undefined, {
          token: message.token,
          password,
        }),
        request('/auth/password-reset/confirm', 'POST', undefined, {
          token: message.token,
          password,
        }),
      ]);
      assert.deepEqual(responses.map((r) => r.status).sort(), [204, 400]);
    });
    void test('expired, superseded and undelivered reset tokens are unusable', async () => {
      await read(
        await request('/auth/password-reset/request', 'POST', undefined, {
          email: email('reset-expired'),
        }),
        202,
      );
      const expired = delivery.messages.at(-1);
      assert.ok(expired);
      await database.client
        .update(passwordResetTokens)
        .set({
          createdAt: new Date(Date.now() - 3600000),
          expiresAt: new Date(Date.now() - 1000),
        })
        .where(eq(passwordResetTokens.tokenHash, tokenHash(expired.token)));
      assert.equal(
        (
          await request('/auth/password-reset/confirm', 'POST', undefined, {
            token: expired.token,
            password,
          })
        ).status,
        400,
      );
      await read(
        await request('/auth/password-reset/request', 'POST', undefined, {
          email: email('reset-expired'),
        }),
        202,
      );
      const superseded = delivery.messages.at(-1);
      assert.ok(superseded);
      delivery.fail = true;
      try {
        await read(
          await request('/auth/password-reset/request', 'POST', undefined, {
            email: email('reset-expired'),
          }),
          202,
        );
      } finally {
        delivery.fail = false;
      }
      const failed = delivery.messages.at(-1);
      assert.ok(failed);
      for (const token of [superseded.token, failed.token])
        assert.equal(
          (
            await request('/auth/password-reset/confirm', 'POST', undefined, {
              token,
              password,
            })
          ).status,
          400,
        );
    });
    void test('rate limit cannot be bypassed by spoofing X-Forwarded-For; keys contain no raw email/IP', async () => {
      const target = email('bruteforce');
      for (let i = 0; i < 10; i++)
        assert.equal(
          (
            await request(
              '/auth/login',
              'POST',
              undefined,
              {
                email: `${' '.repeat(i * 30)}${i % 2 ? target.toUpperCase() : target} `,
                password,
              },
              { 'x-forwarded-for': `203.0.113.${i}` },
            )
          ).status,
          401,
        );
      const blocked = await request('/auth/login', 'POST', undefined, {
        email: target,
        password,
      });
      assert.equal(blocked.status, 429);
      assert.equal(blocked.headers.get('retry-after'), '900');
      const keyHash = createHmac('sha256', config.rateLimitSecret)
        .update(`login:email:${target}`)
        .digest('hex');
      const [bucket] = await database.client
        .select()
        .from(authRateLimits)
        .where(eq(authRateLimits.keyHash, keyHash));
      assert.ok(bucket);
      assert.equal(bucket.hits, 11);
      assert.ok(!JSON.stringify(bucket).includes(target));
    });
    void test('PostgreSQL rate limit increments are atomic across concurrent callers and expire', async () => {
      const key = `fixture:${runId}`;
      rateKeys.add(key);
      const attempts = await Promise.allSettled(
        Array.from({ length: 8 }, () => limiter.consume(key, 3)),
      );
      assert.equal(attempts.filter((a) => a.status === 'fulfilled').length, 3);
      const keyHash = createHmac('sha256', config.rateLimitSecret)
        .update(key)
        .digest('hex');
      await database.client
        .update(authRateLimits)
        .set({ windowEndsAt: new Date(Date.now() - 1000) })
        .where(eq(authRateLimits.keyHash, keyHash));
      await limiter.consume(key, 3);
    });
    void test('DB rejects missing/duplicate owners, duplicate membership, orphan rows and invalid hashes', async () => {
      await assert.rejects(
        database.client.insert(shops).values({ name: 'Ownerless fixture' }),
        dbError('23514'),
      );
      await assert.rejects(
        database.client
          .delete(shopMembers)
          .where(eq(shopMembers.id, ownerBMember.id)),
        dbError('23514'),
      );
      await assert.rejects(
        database.client.insert(shopMembers).values({
          shopId: shopA.id,
          userId: ownerB.userId,
          role: 'SHOP_OWNER',
        }),
        dbError('23505'),
      );
      await assert.rejects(
        database.client.insert(shopMembers).values({
          shopId: shopA.id,
          userId: manager.userId,
          role: 'SHOP_EMPLOYEE',
        }),
        dbError('23505'),
      );
      await assert.rejects(
        database.client.insert(shopMembers).values({
          shopId: shopA.id,
          userId: randomUUID(),
          role: 'SHOP_EMPLOYEE',
        }),
        dbError('23503'),
      );
      await assert.rejects(
        database.client.insert(sessions).values({
          userId: ownerA.userId,
          tokenHash: newToken(),
          expiresAt: new Date(Date.now() + 60000),
        }),
        dbError('23514'),
      );
      await assert.rejects(
        database.client.delete(users).where(eq(users.id, ownerB.userId)),
        dbError('23503'),
      );
    });
    void test('updated_at is maintained by PostgreSQL and authorized owner rename succeeds', async () => {
      const [beforeRow] = await database.client
        .select()
        .from(shops)
        .where(eq(shops.id, shopA.id));
      assert.ok(beforeRow);
      const renamed = await read<Shop>(
        await request(`/shops/${shopA.id}`, 'PATCH', ownerA, {
          name: 'Renamed fixture A',
        }),
      );
      assert.equal(renamed.name, 'Renamed fixture A');
      const [afterRow] = await database.client
        .select()
        .from(shops)
        .where(eq(shops.id, shopA.id));
      assert.ok(afterRow);
      assert.ok(afterRow.updatedAt > beforeRow.updatedAt);
      assert.equal(
        (
          await database.client
            .select()
            .from(passwordResetTokens)
            .where(
              and(
                eq(passwordResetTokens.userId, ids.get('reset') ?? ''),
                isNull(passwordResetTokens.consumedAt),
              ),
            )
        ).length,
        0,
      );
    });
  },
);
