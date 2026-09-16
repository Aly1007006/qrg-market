import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { before, after, test } from 'node:test';
import assert from 'node:assert/strict';
import { Test } from '@nestjs/testing';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { eq, inArray, sql } from 'drizzle-orm';
import { AppModule } from '../src/app.module.js';
import { loadConfig } from '../src/config.js';
import { configureApplication } from '../src/http.js';
import { Database } from '../src/database.js';
import { runMigrations } from '../src/db/migrate.js';
import { AuthService } from '../src/auth/service.js';
import { ShopsService } from '../src/shops/service.js';
import { AnalyticsService } from '../src/analytics/service.js';
import {
  analyticsEvents,
  categories,
  products,
  productVariants,
  shops,
  shopMembers,
  users,
  customerRequests,
  shopContacts,
  shopLocations,
} from '../src/db/schema.js';
import { paidFixtures, removeBillingFixtures } from './billing-fixtures.js';
import { cleanupExpired } from '../src/db/cleanup.js';
import type { Principal } from '../src/auth/metadata.js';
const run = randomUUID();
const config = loadConfig({
  ...process.env,
  NODE_ENV: 'test',
  AUTH_RATE_LIMIT_SECRET: run + '-analytics',
});
void test('real contact clicks and sitemap only expose currently public resources', async () => {
  await db.client
    .insert(shopContacts)
    .values({ shopId: shopA, whatsappPhone: '+77001234567' });
  await db.client.insert(shopLocations).values({
    shopId: shopA,
    address: 'Test address',
    twoGisUrl: 'https://2gis.kz/karaganda/firm/70000001038483747',
    twoGisFirmId: '70000001038483747',
  });
  for (const type of ['WHATSAPP_CLICK', 'TWO_GIS_CLICK']) {
    assert.equal(
      (
        await request('/public/analytics', 'POST', {
          eventId: randomUUID(),
          type,
          resource: 'product',
          slug,
        })
      ).status,
      202,
    );
  }
  const entries = async () => {
    const response = await request('/public/seo/entries?page=1');
    assert.equal(response.status, 200);
    return (await response.json()) as { path: string }[];
  };
  assert.ok((await entries()).some((row) => row.path === '/product/' + slug));
  await db.client
    .update(shops)
    .set({ status: 'SUSPENDED' })
    .where(eq(shops.id, shopA));
  assert.ok(
    !(await entries()).some(
      (row) =>
        row.path === '/product/' + slug || row.path === '/shop/' + shopSlug,
    ),
  );
  await db.client
    .update(shops)
    .set({ status: 'ACTIVE' })
    .where(eq(shops.id, shopA));
  await db.client.delete(shopContacts).where(eq(shopContacts.shopId, shopA));
  await db.client.delete(shopLocations).where(eq(shopLocations.shopId, shopA));
});
void test('built web analytics proxy, private report and sitemap work with real API', async () => {
  const webRequire = createRequire(resolve('../web/package.json'));
  const origin = 'http://127.0.0.1:43189';
  const child = spawn(
    process.execPath,
    [
      webRequire.resolve('next/dist/bin/next'),
      'start',
      '-p',
      '43189',
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
        QRG_SITE_URL: 'https://qrg.example.test',
        QRG_INDEXING_ENABLED: 'true',
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
        if ((await fetch(origin)).ok) {
          ready = true;
          break;
        }
      } catch {
        /* startup not listening yet */
      }
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    assert.ok(ready);
    const headers = {
      origin: config.appOrigin,
      'content-type': 'application/json',
      'x-qrg-client': 'web',
    };
    const event = {
      eventId: randomUUID(),
      type: 'SHOP_VIEW',
      resource: 'shop',
      slug: shopSlug,
    };
    const post = (body: unknown, overrides: Record<string, string> = {}) =>
      fetch(origin + '/api/analytics', {
        method: 'POST',
        headers: { ...headers, ...overrides },
        body: JSON.stringify(body),
      });
    assert.equal((await post(event)).status, 202);
    assert.equal((await post(event)).status, 202);
    assert.equal(
      (await post(event, { origin: 'https://evil.test' })).status,
      403,
    );
    assert.equal(
      (await post({ ...event, extra: 'x'.repeat(2000) })).status,
      413,
    );
    assert.equal((await post({ ...event, phone: '+77001234567' })).status, 400);
    const report = await fetch(origin + `/seller/${shopA}/statistics?days=30`, {
      headers: { cookie: 'qrg_session=' + a.token },
    });
    const html = await report.text();
    assert.equal(report.status, 200);
    assert.match(html, /Статистика магазина/);
    assert.match(html, /Просмотры магазина/);
    assert.match(html, /noindex/);
    const forbidden = await fetch(origin + `/seller/${shopA}/statistics`, {
      headers: { cookie: 'qrg_session=' + b.token, 'user-agent': 'Googlebot' },
    });
    assert.equal(forbidden.status, 404);
    const robots = await (await fetch(origin + '/robots.txt')).text();
    assert.match(robots, /public-pages\/sitemap\/0.xml/);
    const rootSitemap = await (await fetch(origin + '/sitemap.xml')).text();
    assert.ok(rootSitemap.includes('https://qrg.example.test/catalog'));
    const sitemap = await fetch(origin + '/public-pages/sitemap/0.xml');
    assert.equal(sitemap.status, 200);
    assert.ok((await sitemap.text()).includes('/product/' + slug));
    if (process.env.QRG_ANALYTICS_QA === 'true') {
      console.log(
        'Local test QA',
        JSON.stringify({
          origin,
          email: run + '-a@example.test',
          shopId: shopA,
          productSlug: slug,
        }),
      );
      await new Promise((resolve) => setTimeout(resolve, 180000));
    }
  } finally {
    if (child.exitCode === null) {
      const exited = once(child, 'exit');
      child.kill();
      await exited;
    }
  }
});
assert.ok(new URL(config.databaseUrl).pathname.endsWith('_test'));
let app: NestExpressApplication;
let db: Database;
let base: string;
let service: AnalyticsService;
let a: { token: string; principal: Principal };
let b: typeof a;
let shopA: string;
let shopB: string;
let productA: string;
let category: string;
let shopSlug: string;
const slug = 'analytics-' + run;
const request = (
  path: string,
  method = 'GET',
  body?: unknown,
  client?: typeof a,
) =>
  fetch(base + '/api/v1' + path, {
    method,
    headers: {
      origin: config.appOrigin,
      'x-qrg-client': 'web',
      'content-type': 'application/json',
      ...(client
        ? {
            cookie: 'qrg_session=' + client.token,
            'x-qrg-csrf': client.principal.csrfToken,
          }
        : {}),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
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
  service = app.get(AnalyticsService);
  const auth = app.get(AuthService);
  const credentials = [];
  for (const key of ['a', 'b']) {
    const email = `${run}-${key}@example.test`;
    await auth.signup(email, 'Analytics local fixture password 2026!');
    const login = await auth.login(
      email,
      'Analytics local fixture password 2026!',
    );
    credentials.push({
      token: login.token,
      principal: await auth.authenticate(login.token),
    });
  }
  a = credentials[0]!;
  b = credentials[1]!;
  shopA = (await app.get(ShopsService).create(a.principal, 'Analytics A')).id;
  shopB = (await app.get(ShopsService).create(b.principal, 'Analytics B')).id;
  await paidFixtures(db, [shopA, shopB]);
  const [shop] = await db.client
    .update(shops)
    .set({ status: 'ACTIVE' })
    .where(eq(shops.id, shopA))
    .returning();
  shopSlug = shop!.slug;
  const [cat] = await db.client
    .insert(categories)
    .values({ name: 'Analytics test', slug })
    .returning();
  category = cat!.id;
  const [product] = await db.client
    .insert(products)
    .values({
      shopId: shopA,
      categoryId: category,
      name: 'Analytics product',
      slug,
      basePrice: 100,
      status: 'PUBLISHED',
    })
    .returning();
  productA = product!.id;
  await db.client
    .insert(productVariants)
    .values({ productId: productA, shopId: shopA, size: 'M', available: true });
});
after(async () => {
  if (db) {
    if (shopA)
      await db.client
        .delete(customerRequests)
        .where(eq(customerRequests.shopId, shopA));
    if (shopA && shopB) {
      await removeBillingFixtures(db, [shopA, shopB]);
      await db.client.delete(shops).where(inArray(shops.id, [shopA, shopB]));
    }
    await db.client
      .delete(users)
      .where(
        inArray(users.email, [
          `${run}-a@example.test`,
          `${run}-b@example.test`,
        ]),
      );
    if (category)
      await db.client.delete(categories).where(eq(categories.id, category));
  }
  await app?.close();
});
void test('collection accepts only real visible resources, server timestamps and allowed event types', async () => {
  const event = {
    eventId: randomUUID(),
    type: 'PRODUCT_VIEW',
    resource: 'product',
    slug,
  };
  assert.equal((await request('/public/analytics', 'POST', event)).status, 202);
  for (const extra of [
    { shopId: shopB },
    { phone: '+77001234567' },
    { createdAt: new Date().toISOString() },
    { type: 'CUSTOMER_REQUEST_CREATED' },
    { type: 'FAVORITE_ADDED' },
  ])
    assert.equal(
      (await request('/public/analytics', 'POST', { ...event, ...extra }))
        .status,
      400,
    );
  assert.equal(
    (await request('/public/analytics', 'POST', { ...event, slug: 'missing' }))
      .status,
    404,
  );
  assert.equal(
    (
      await request('/public/analytics', 'POST', {
        ...event,
        type: 'SHOP_VIEW',
      })
    ).status,
    400,
  );
  assert.equal(
    (
      await request('/public/analytics', 'POST', {
        ...event,
        type: 'WHATSAPP_CLICK',
      })
    ).status,
    404,
  );
  assert.equal(
    (
      await request('/public/analytics', 'POST', {
        ...event,
        type: 'TWO_GIS_CLICK',
      })
    ).status,
    404,
  );
  await db.client
    .update(shops)
    .set({ status: 'SUSPENDED' })
    .where(eq(shops.id, shopA));
  assert.equal((await request('/public/analytics', 'POST', event)).status, 404);
  await db.client
    .update(shops)
    .set({ status: 'ACTIVE' })
    .where(eq(shops.id, shopA));
});
void test('concurrent duplicate delivery is idempotent and event rows contain no PII columns', async () => {
  const event = {
    eventId: randomUUID(),
    type: 'SHOP_VIEW' as const,
    resource: 'shop' as const,
    slug: shopSlug,
  };
  await Promise.all(Array.from({ length: 8 }, () => service.record(event)));
  const rows = await db.client
    .select()
    .from(analyticsEvents)
    .where(eq(analyticsEvents.eventId, event.eventId));
  assert.equal(rows.length, 1);
  assert.deepEqual(
    Object.keys(rows[0]!).sort(),
    ['createdAt', 'eventId', 'id', 'productId', 'shopId', 'type'].sort(),
  );
});
void test('seller analytics enforces session, owner/manager permission, tenant IDs and membership revocation', async () => {
  assert.equal((await request(`/shops/${shopA}/analytics`)).status, 401);
  assert.equal(
    (await request(`/shops/${shopA}/analytics`, 'GET', undefined, b)).status,
    404,
  );
  assert.equal(
    (
      await request(
        `/shops/${shopA}/analytics?days=90&shop_id=${shopB}`,
        'GET',
        undefined,
        a,
      )
    ).status,
    400,
  );
  assert.equal(
    (await request(`/shops/${shopA}/analytics?days=8`, 'GET', undefined, a))
      .status,
    400,
  );
  assert.equal(
    (await request(`/shops/${shopA}/analytics`, 'POST', {}, a)).status,
    404,
  );
  await db.client.insert(shopMembers).values({
    shopId: shopA,
    userId: b.principal.userId,
    role: 'SHOP_EMPLOYEE',
  });
  assert.equal(
    (await request(`/shops/${shopA}/analytics`, 'GET', undefined, b)).status,
    403,
  );
  await db.client
    .update(shopMembers)
    .set({ role: 'SHOP_MANAGER' })
    .where(sql`shop_id=${shopA} AND user_id=${b.principal.userId}`);
  assert.equal(
    (await request(`/shops/${shopA}/analytics`, 'GET', undefined, b)).status,
    200,
  );
  await db.client
    .delete(shopMembers)
    .where(sql`shop_id=${shopA} AND user_id=${b.principal.userId}`);
  assert.equal(
    (await request(`/shops/${shopA}/analytics`, 'GET', undefined, b)).status,
    404,
  );
});
void test('7/30/90 rolling periods filter events, top products and other shops correctly', async () => {
  await db.client
    .delete(analyticsEvents)
    .where(eq(analyticsEvents.shopId, shopA));
  for (const days of [1, 8, 31, 91])
    await db.client.insert(analyticsEvents).values({
      eventId: randomUUID(),
      type: 'PRODUCT_VIEW',
      shopId: shopA,
      productId: productA,
      createdAt: new Date(Date.now() - days * 86400000),
    });
  for (const [days, count] of [
    [7, 1],
    [30, 2],
    [90, 3],
  ]) {
    const report = await service.summary(a.principal, shopA, days!);
    assert.equal(report.totals.PRODUCT_VIEW, count);
    assert.equal(report.popularProducts[0]?.views, count);
    assert.equal(
      new Date(report.to).getTime() - new Date(report.from).getTime(),
      days! * 86400000,
    );
  }
  await assert.rejects(
    db.client.insert(analyticsEvents).values({
      eventId: randomUUID(),
      type: 'PRODUCT_VIEW',
      shopId: shopB,
      productId: productA,
    }),
  );
});
void test('request event is emitted transactionally once without copying customer fields', async () => {
  const row = {
    shopId: shopA,
    productId: productA,
    name: 'Test',
    phone: '+77001234567',
    productName: 'Test',
    quantity: 1,
    consentVersion: 'test',
    submissionHash: 'a'.repeat(64),
    dedupHash: 'b'.repeat(64),
  };
  const id = randomUUID();
  await db.client.insert(customerRequests).values({ ...row, id });
  await db.client
    .update(customerRequests)
    .set({ status: 'CONFIRMED' })
    .where(eq(customerRequests.id, id));
  assert.equal(
    (
      await db.client
        .select()
        .from(analyticsEvents)
        .where(eq(analyticsEvents.eventId, id))
    ).length,
    1,
  );
  const rolled = randomUUID();
  await assert.rejects(
    db.client.transaction(async (tx) => {
      await tx
        .insert(customerRequests)
        .values({ ...row, id: rolled, submissionHash: 'c'.repeat(64) });
      throw new Error('rollback');
    }),
  );
  assert.equal(
    (
      await db.client
        .select()
        .from(analyticsEvents)
        .where(eq(analyticsEvents.eventId, rolled))
    ).length,
    0,
  );
});
void test('bounded retention preserves current events; selective report has an indexed SQL plan', async () => {
  const old = randomUUID();
  await db.client.insert(analyticsEvents).values({
    eventId: old,
    type: 'SHOP_VIEW',
    shopId: shopA,
    createdAt: new Date(Date.now() - 101 * 86400000),
  });
  await db.client.transaction((tx) => cleanupExpired(tx));
  assert.equal(
    (
      await db.client
        .select()
        .from(analyticsEvents)
        .where(eq(analyticsEvents.eventId, old))
    ).length,
    0,
  );
  await db.client.execute(
    sql`INSERT INTO analytics_events(event_id,type,shop_id) SELECT gen_random_uuid(),'SHOP_VIEW',${shopB}::uuid FROM generate_series(1,10000)`,
  );
  await db.client.execute(sql`ANALYZE analytics_events`);
  const plan = await db.client.execute(
    sql`EXPLAIN (ANALYZE,BUFFERS,FORMAT JSON) SELECT type,count(*) FROM analytics_events WHERE shop_id=${shopA} AND created_at>=now()-interval '90 days' GROUP BY type`,
  );
  const text = JSON.stringify(plan.rows);
  assert.match(text, /analytics_shop_time_idx/);
  console.log('analytics report EXPLAIN', text);
});
