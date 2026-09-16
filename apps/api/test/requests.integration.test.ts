import 'reflect-metadata';
import { paidFixtures, removeBillingFixtures } from './billing-fixtures.js';
import { before, after, test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID, createHmac } from 'node:crypto';
import { resolve } from 'node:path';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { once } from 'node:events';
import { Test } from '@nestjs/testing';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { and, eq, inArray, sql } from 'drizzle-orm';
import { AppModule } from '../src/app.module.js';
import { loadConfig } from '../src/config.js';
import { configureApplication } from '../src/http.js';
import { Database } from '../src/database.js';
import { runMigrations } from '../src/db/migrate.js';
import { AuthService } from '../src/auth/service.js';
import { ShopsService } from '../src/shops/service.js';
import { SellerCatalogService } from '../src/catalogue/seller.service.js';
import { ProductCreateDto, VariantDto } from '../src/catalogue/dto.js';
import {
  categories,
  products,
  productVariants,
  shops,
  users,
  shopMembers,
  shopContacts,
  customerRequests,
  authRateLimits,
} from '../src/db/schema.js';
import { challengeFor } from '../src/requests/spam.js';
import { PRIVACY_VERSION } from '../src/requests/dto.js';
const run = randomUUID();
const config = loadConfig({
  ...process.env,
  NODE_ENV: 'test',
  APP_ORIGIN: 'http://127.0.0.1:43186',
  AUTH_RATE_LIMIT_SECRET: run + '-requests-test',
});
assert.ok(new URL(config.databaseUrl).pathname.endsWith('_test'));
let app: NestExpressApplication,
  db: Database,
  base: string,
  shopA: string,
  shopB: string,
  categoryId: string,
  productA: string,
  productB: string,
  variantA: string,
  variantB: string;
let a: Awaited<ReturnType<AuthService['login']>>, b: typeof a;
let sequence = 0;
const emails = [run + '-lead-a@example.test', run + '-lead-b@example.test'];
const body = (extra: Record<string, unknown> = {}) => ({
  name: 'Guest ' + ++sequence,
  phone: '+7700' + String(1000000 + sequence),
  productId: productA,
  variantId: variantA,
  quantity: 1,
  privacyConsent: true,
  policyVersion: PRIVACY_VERSION,
  challenge: challengeFor(productA, config.rateLimitSecret, Date.now() - 3000),
  ...extra,
});
async function request(
  path: string,
  method = 'GET',
  data?: unknown,
  client?: typeof a,
) {
  return fetch(base + '/api/v1' + path, {
    method,
    headers: {
      origin: config.appOrigin,
      'x-qrg-client': 'web',
      'content-type': 'application/json',
      ...(client
        ? {
            cookie: 'qrg_session=' + client.token,
            'x-qrg-csrf': client.csrfToken,
          }
        : {}),
    },
    ...(data === undefined ? {} : { body: JSON.stringify(data) }),
  });
}
const submit = (data: unknown) => request('/public/requests', 'POST', data);
before(async () => {
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
    tenant = app.get(ShopsService),
    catalog = app.get(SellerCatalogService);
  const password = 'Request test fixture password 2026!';
  await auth.signup(emails[0]!, password);
  await auth.signup(emails[1]!, password);
  a = await auth.login(emails[0]!, password);
  b = await auth.login(emails[1]!, password);
  const pa = await auth.authenticate(a.token),
    pb = await auth.authenticate(b.token);
  shopA = (await tenant.create(pa, 'Lead test ' + run)).id;
  shopB = (await tenant.create(pb, 'Other lead shop ' + run)).id;
  await paidFixtures(db, [shopA, shopB]);
  await db.client
    .update(shops)
    .set({ status: 'ACTIVE' })
    .where(inArray(shops.id, [shopA, shopB]));
  const [c] = await db.client
    .insert(categories)
    .values({ name: 'Lead category', slug: 'lead-' + run })
    .returning();
  categoryId = c!.id;
  const fields = {
    name: 'Lead product ' + run,
    categoryId,
    basePrice: 1000,
    status: 'PUBLISHED',
    variants: [Object.assign(new VariantDto(), { size: 'M', color: 'чёрный' })],
  };
  productA = (
    await catalog.create(
      pa,
      shopA,
      Object.assign(new ProductCreateDto(), fields, { slug: 'lead-a-' + run }),
    )
  ).id;
  productB = (
    await catalog.create(
      pb,
      shopB,
      Object.assign(new ProductCreateDto(), fields, { slug: 'lead-b-' + run }),
    )
  ).id;
  variantA = (
    await db.client
      .select()
      .from(productVariants)
      .where(eq(productVariants.productId, productA))
  )[0]!.id;
  variantB = (
    await db.client
      .select()
      .from(productVariants)
      .where(eq(productVariants.productId, productB))
  )[0]!.id;
  await db.client
    .insert(shopContacts)
    .values({ shopId: shopA, whatsappPhone: '+77001234567' });
});
after(async () => {
  if (db && shopA && shopB) await removeBillingFixtures(db, [shopA, shopB]);
  if (db) {
    if (shopA && shopB) {
      await db.client
        .delete(customerRequests)
        .where(inArray(customerRequests.shopId, [shopA, shopB]));
      await db.client.delete(shops).where(inArray(shops.id, [shopA, shopB]));
    }
    await db.client.delete(users).where(inArray(users.email, emails));
    if (categoryId)
      await db.client.delete(categories).where(eq(categories.id, categoryId));
  }
  await app?.close();
});
void test('guest submits without account; normalized phone, consent proof, snapshots and NEW status', async () => {
  const data = body({
    name: '  Покупатель  ',
    phone: '+7 (700) 222-33-44',
    comment: '  Уточните наличие  ',
  });
  const r = await submit(data);
  assert.equal(r.status, 202, await r.clone().text());
  assert.deepEqual(await r.json(), { accepted: true });
  assert.equal(r.headers.get('set-cookie'), null);
  const [row] = await db.client
    .select()
    .from(customerRequests)
    .where(eq(customerRequests.phone, '+77002223344'));
  assert.ok(row);
  assert.equal(row.name, 'Покупатель');
  assert.equal(row.comment, 'Уточните наличие');
  assert.equal(row.shopId, shopA);
  assert.equal(row.status, 'NEW');
  assert.equal(row.consentType, 'PRIVACY');
  assert.equal(row.consentVersion, PRIVACY_VERSION);
  assert.ok(row.consentAt);
  assert.equal(row.variantLabel, 'M · чёрный');
  const withoutVariant = body({ variantId: null });
  assert.equal((await submit(withoutVariant)).status, 202);
  const [unselected] = await db.client
    .select()
    .from(customerRequests)
    .where(eq(customerRequests.phone, withoutVariant.phone));
  assert.equal(unselected?.variantId, null);
  assert.equal(unselected?.variantLabel, '');
  assert.notEqual(row.submissionHash, data.challenge);
  assert.equal(
    (await db.client.select().from(users).where(inArray(users.email, emails)))
      .length,
    2,
  );
});
void test('consent, phone, quantities, unknown fields, HTML and oversized bodies are rejected', async () => {
  for (const headers of [
    { origin: 'https://evil.test', 'x-qrg-client': 'web' },
    { origin: config.appOrigin },
  ]) {
    const response = await fetch(base + '/api/v1/public/requests', {
      method: 'POST',
      headers: { ...headers, 'content-type': 'application/json' },
      body: JSON.stringify(body()),
    });
    assert.equal(response.status, 403);
  }
  for (const extra of [
    { privacyConsent: false },
    { privacyConsent: 'true' },
    { policyVersion: 'old' },
    { quantity: 0 },
    { quantity: 1.5 },
    { quantity: 100 },
    { phone: 'javascript:alert(1)' },
    { name: '<img src=x onerror=alert(1)>' },
    { comment: '<script>alert(1)</script>' },
    { status: 'CONFIRMED' },
    { shop_id: shopB },
    { shopId: shopB },
    { role: 'SHOP_OWNER' },
    { paid: true },
  ])
    assert.equal(
      (await submit(body(extra))).status,
      400,
      JSON.stringify(extra),
    );
  assert.equal(
    (await submit({ ...body(), comment: 'x'.repeat(9000) })).status,
    413,
  );
});
void test('honeypot, fast/expired/forged challenge and foreign variant fail', async () => {
  for (const extra of [
    { website: 'spam' },
    { challenge: challengeFor(productA, config.rateLimitSecret) },
    {
      challenge: challengeFor(
        productA,
        config.rateLimitSecret,
        Date.now() - 1900000,
      ),
    },
    {
      challenge: challengeFor(
        productB,
        config.rateLimitSecret,
        Date.now() - 3000,
      ),
    },
    { challenge: 'forged'.repeat(20) },
    { variantId: variantB },
  ])
    assert.equal((await submit(body(extra))).status, 400);
});
void test('only published products of ACTIVE shops accept challenges and requests', async () => {
  assert.equal(
    (await request('/public/requests/challenge/' + productA)).status,
    200,
  );
  await db.client
    .update(shops)
    .set({ status: 'SUSPENDED' })
    .where(eq(shops.id, shopA));
  assert.equal((await submit(body())).status, 404);
  assert.equal(
    (await request('/public/requests/challenge/' + productA)).status,
    404,
  );
  await db.client
    .update(shops)
    .set({ status: 'ACTIVE' })
    .where(eq(shops.id, shopA));
  await db.client
    .update(products)
    .set({ status: 'ARCHIVED' })
    .where(eq(products.id, productA));
  assert.equal((await submit(body())).status, 404);
  await db.client
    .update(products)
    .set({ status: 'PUBLISHED' })
    .where(eq(products.id, productA));
});
void test('duplicate submissions are atomic/idempotent; altered replay is rejected', async () => {
  const data = body();
  const results = await Promise.all([submit(data), submit(data)]);
  assert.deepEqual(
    results.map((r) => r.status),
    [202, 202],
  );
  assert.equal(
    (
      await submit({
        ...data,
        challenge: challengeFor(
          productA,
          config.rateLimitSecret,
          Date.now() - 3000,
        ),
      })
    ).status,
    202,
  );
  assert.equal(
    (
      await db.client
        .select()
        .from(customerRequests)
        .where(eq(customerRequests.phone, data.phone))
    ).length,
    1,
  );
  assert.equal((await submit({ ...data, quantity: 2 })).status, 409);
});
void test('seller list/detail/status are tenant-scoped; foreign IDs and mass assignment fail', async () => {
  const [row] = await db.client
    .select()
    .from(customerRequests)
    .where(eq(customerRequests.shopId, shopA));
  assert.ok(row);
  for (const path of [
    '/shops/' + shopA + '/requests',
    '/shops/' + shopA + '/requests/' + row.id,
  ])
    assert.equal((await request(path, 'GET', undefined, b)).status, 404);
  assert.equal(
    (
      await request(
        '/shops/' + shopB + '/requests/' + row.id,
        'GET',
        undefined,
        b,
      )
    ).status,
    404,
  );
  assert.equal(
    (
      await request(
        '/shops/' + shopA + '/requests/' + row.id,
        'PATCH',
        { status: 'CONFIRMED', expectedStatus: 'NEW' },
        b,
      )
    ).status,
    404,
  );
  assert.equal(
    (
      await request(
        '/shops/' + shopA + '/requests/' + row.id,
        'PATCH',
        { status: 'CONFIRMED', expectedStatus: 'NEW', shopId: shopB },
        a,
      )
    ).status,
    400,
  );
  const list = await request(
    '/shops/' + shopA + '/requests',
    'GET',
    undefined,
    a,
  );
  assert.equal(list.status, 200);
  assert.ok(!(await list.text()).includes(row.phone));
  assert.equal(
    (await request('/shops/' + shopA + '/requests/' + row.id)).status,
    401,
  );
  assert.equal((await request('/public/requests/' + row.id)).status, 404);
});
void test('all seller roles can process own requests; revoke membership blocks immediately', async () => {
  const [row] = await db.client
    .select()
    .from(customerRequests)
    .where(eq(customerRequests.shopId, shopA));
  assert.ok(row);
  for (const role of ['SHOP_MANAGER', 'SHOP_EMPLOYEE'] as const) {
    const [m] = await db.client
      .insert(shopMembers)
      .values({ shopId: shopA, userId: b.user.id, role })
      .returning();
    assert.equal(
      (
        await request(
          '/shops/' + shopA + '/requests/' + row.id,
          'GET',
          undefined,
          b,
        )
      ).status,
      200,
    );
    assert.equal(
      (
        await request(
          '/shops/' + shopA + '/requests/' + row.id,
          'PATCH',
          { status: row.status, expectedStatus: row.status },
          b,
        )
      ).status,
      200,
    );
    await db.client.delete(shopMembers).where(eq(shopMembers.id, m!.id));
    assert.equal(
      (
        await request(
          '/shops/' + shopA + '/requests/' + row.id,
          'PATCH',
          { status: 'CONFIRMED', expectedStatus: row.status },
          b,
        )
      ).status,
      404,
    );
    assert.equal(
      (
        await request(
          '/shops/' + shopA + '/requests/' + row.id,
          'GET',
          undefined,
          b,
        )
      ).status,
      404,
    );
  }
});
void test('CONFIRMED is only communication status; optimistic concurrency prevents lost updates', async () => {
  const [row] = await db.client
    .select()
    .from(customerRequests)
    .where(eq(customerRequests.shopId, shopA));
  assert.ok(row);
  const path = '/shops/' + shopA + '/requests/' + row.id;
  const result = await request(
    path,
    'PATCH',
    { status: 'CONFIRMED', expectedStatus: row.status },
    a,
  );
  assert.equal(result.status, 200);
  assert.equal(
    (
      await request(
        path,
        'PATCH',
        { status: 'CLOSED', expectedStatus: row.status },
        a,
      )
    ).status,
    409,
  );
  for (const status of ['VIEWED', 'CONTACTED', 'REJECTED', 'CLOSED']) {
    const current = await db.client
      .select()
      .from(customerRequests)
      .where(eq(customerRequests.id, row.id));
    assert.equal(
      (
        await request(
          path,
          'PATCH',
          { status, expectedStatus: current[0]!.status },
          a,
        )
      ).status,
      200,
    );
  }
  const [updated] = await db.client
    .select()
    .from(customerRequests)
    .where(eq(customerRequests.id, row.id));
  assert.equal(updated?.statusChangedBy, a.user.id);
  assert.equal(updated?.consentAt.getTime(), row.consentAt.getTime());
  const forbidden = await db.client.execute(
    sql`SELECT tablename FROM pg_tables WHERE schemaname='public' AND tablename IN ('customer_payments','seller_wallets','payouts','escrow_transactions')`,
  );
  assert.equal(forbidden.rows.length, 0);
});
void test('database rejects cross-shop product/variant associations and invalid consent/quantity', async () => {
  const [row] = await db.client
    .select()
    .from(customerRequests)
    .where(eq(customerRequests.shopId, shopA));
  assert.ok(row);
  for (const patch of [
    { shopId: shopB },
    { variantId: variantB },
    { quantity: 0 },
    { consentType: 'MARKETING' },
    { phone: 'bad' },
  ])
    await assert.rejects(
      db.client
        .update(customerRequests)
        .set(patch)
        .where(eq(customerRequests.id, row.id)),
    );
});
void test('rate limits use normalized phone and real socket, not forwarded headers', async () => {
  const key = createHmac('sha256', config.rateLimitSecret)
    .update('lead:POST:ip:127.0.0.1')
    .digest('hex');
  await db.client.delete(authRateLimits).where(eq(authRateLimits.keyHash, key));
  const data = body();
  for (let i = 0; i < 5; i++) assert.equal((await submit(data)).status, 202);
  assert.equal(
    (await submit({ ...data, phone: data.phone.replace('+7700', '+7 (700) ') }))
      .status,
    429,
  );
  await db.client
    .update(authRateLimits)
    .set({ hits: 30 })
    .where(eq(authRateLimits.keyHash, key));
  const r = await fetch(base + '/api/v1/public/requests', {
    method: 'POST',
    headers: {
      origin: config.appOrigin,
      'x-qrg-client': 'web',
      'content-type': 'application/json',
      'x-forwarded-for': '8.8.8.8',
    },
    body: JSON.stringify(body()),
  });
  assert.equal(r.status, 429);
  assert.equal(r.headers.get('retry-after'), '900');
  await db.client.delete(authRateLimits).where(eq(authRateLimits.keyHash, key));
});

if (process.env.QRG_TEST_BUILT_REQUESTS === 'true')
  void test('built Next guest submission, WhatsApp and seller request flow', async () => {
    const requireWeb = createRequire(resolve('../web/package.json'));
    const child = spawn(
      process.execPath,
      [
        requireWeb.resolve('next/dist/bin/next'),
        'start',
        '-p',
        '43186',
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
    const origin = config.appOrigin;
    try {
      let ready = false;
      for (let i = 0; i < 100; i++) {
        if (child.exitCode !== null) throw new Error('Built web exited');
        try {
          ready = (await fetch(origin + '/seller/login')).ok;
          if (ready) break;
        } catch {
          /* bounded startup retry */
        }
        await new Promise((r) => setTimeout(r, 100));
      }
      assert.ok(ready);
      const product = await fetch(origin + '/product/lead-a-' + run);
      assert.equal(product.status, 200);
      const html = await product.text();
      assert.match(html, /Заказать у продавца/);
      assert.match(html, /https:\/\/wa.me\/77001234567/);
      assert.match(html, /QRG MARKET не принимает/);
      const challengeResponse = await fetch(
        origin + '/api/requests?productId=' + productA,
      );
      assert.equal(challengeResponse.status, 200);
      const challenge = (await challengeResponse.json()) as {
        challenge: string;
        policyVersion: string;
      };
      assert.equal(challenge.policyVersion, PRIVACY_VERSION);
      await new Promise((r) => setTimeout(r, 2100));
      const data = body({
        challenge: challenge.challenge,
        name: 'Guest via Next BFF',
      });
      const headers = {
        origin,
        'content-type': 'application/json',
        'x-qrg-client': 'web',
      };
      assert.equal(
        (
          await fetch(origin + '/api/requests', {
            method: 'POST',
            headers: { ...headers, origin: 'https://evil.test' },
            body: JSON.stringify(data),
          })
        ).status,
        403,
      );
      assert.equal(
        (
          await fetch(origin + '/api/requests', {
            method: 'POST',
            headers,
            body: 'x'.repeat(9000),
          })
        ).status,
        413,
      );
      const response = await fetch(origin + '/api/requests', {
        method: 'POST',
        headers,
        body: JSON.stringify(data),
      });
      assert.equal(response.status, 202, await response.clone().text());
      assert.deepEqual(await response.json(), { accepted: true });
      assert.equal(response.headers.get('set-cookie'), null);
      const [row] = await db.client
        .select()
        .from(customerRequests)
        .where(
          and(
            eq(customerRequests.shopId, shopA),
            eq(customerRequests.name, 'Guest via Next BFF'),
          ),
        );
      assert.ok(row);
      const seller = await fetch(
        origin + '/seller/' + shopA + '/requests/' + row.id,
        { headers: { cookie: 'qrg_session=' + a.token } },
      );
      assert.equal(seller.status, 200);
      const detail = await seller.text();
      assert.ok(detail.includes(row.phone));
      assert.ok(detail.includes('не факт оплаты'));
      const foreign = await fetch(
        origin + '/api/seller/shops/' + shopA + '/requests/' + row.id,
        { headers: { cookie: 'qrg_session=' + b.token } },
      );
      assert.equal(foreign.status, 404);
      const status = await fetch(
        origin + '/api/seller/shops/' + shopA + '/requests/' + row.id,
        {
          method: 'PATCH',
          headers: {
            ...headers,
            cookie: 'qrg_session=' + a.token,
            'x-qrg-csrf': a.csrfToken,
          },
          body: JSON.stringify({ status: 'CONFIRMED', expectedStatus: 'NEW' }),
        },
      );
      assert.equal(status.status, 200);
      assert.equal((await fetch(origin + '/privacy/requests')).status, 200);
    } finally {
      if (child.exitCode === null) {
        const exited = once(child, 'exit');
        child.kill();
        await exited;
      }
    }
  });
