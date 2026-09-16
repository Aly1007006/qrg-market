import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import { before, after, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { Test } from '@nestjs/testing';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { eq, inArray } from 'drizzle-orm';
import { AppModule } from '../src/app.module.js';
import { loadConfig } from '../src/config.js';
import { configureApplication } from '../src/http.js';
import { Database } from '../src/database.js';
import { runMigrations } from '../src/db/migrate.js';
import { AuthService } from '../src/auth/service.js';
import type { Principal } from '../src/auth/metadata.js';
import { ShopsService } from '../src/shops/service.js';
import {
  analyticsEvents,
  categories,
  productDrafts,
  productImages,
  products,
  shops,
  users,
} from '../src/db/schema.js';

void describe(
  'PHASE 8B seller operations security',
  { concurrency: false },
  () => {
    const run = randomUUID();
    const config = loadConfig({
      ...process.env,
      NODE_ENV: 'test',
      AUTH_RATE_LIMIT_SECRET: run + '-seller-operations',
    });
    assert.ok(new URL(config.databaseUrl).pathname.endsWith('_test'));
    let app: NestExpressApplication, db: Database, origin: string;
    let a: { token: string; principal: Principal }, b: typeof a;
    let shopA: string, shopB: string, categoryId: string, productId: string;
    const draftId = randomUUID();
    const emails = [run + '-a@example.test', run + '-b@example.test'];
    const content = () => ({
      name: 'Пальто <script>alert(1)</script>',
      categoryId,
      basePrice: 12000,
      variants: [{ available: true }],
    });
    const request = (
      path: string,
      method = 'GET',
      body?: unknown,
      client = a,
    ) =>
      fetch(origin + '/api/v1' + path, {
        method,
        headers: {
          origin: config.appOrigin,
          'content-type': 'application/json',
          'x-qrg-client': 'web',
          cookie: 'qrg_session=' + client.token,
          'x-qrg-csrf': client.principal.csrfToken,
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
    const path = () => '/shops/' + shopA;
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
      origin = await app.getUrl();
      db = app.get(Database);
      const auth = app.get(AuthService);
      const tenant = app.get(ShopsService);
      const password = 'Operations fixture password 2026!';
      await auth.signup(emails[0]!, password);
      await auth.signup(emails[1]!, password);
      const al = await auth.login(emails[0]!, password),
        bl = await auth.login(emails[1]!, password);
      a = { token: al.token, principal: await auth.authenticate(al.token) };
      b = { token: bl.token, principal: await auth.authenticate(bl.token) };
      shopA = (await tenant.create(a.principal, 'Operations A')).id;
      shopB = (await tenant.create(b.principal, 'Operations B')).id;
      const [category] = await db.client
        .insert(categories)
        .values({ name: 'Тестовая категория', slug: 'operations-' + run })
        .returning();
      categoryId = category!.id;
    });
    after(async () => {
      if (db) {
        if (shopA && shopB) {
          await db.client
            .delete(productDrafts)
            .where(inArray(productDrafts.shopId, [shopA, shopB]));
          await db.client
            .delete(shops)
            .where(inArray(shops.id, [shopA, shopB]));
        }
        await db.client.delete(users).where(inArray(users.email, emails));
        if (categoryId)
          await db.client
            .delete(categories)
            .where(eq(categories.id, categoryId));
      }
      await app?.close();
    });
    void test('incomplete draft saved, stale concurrent update conflicts; no products yet', async () => {
      assert.equal(
        (
          await request(path() + '/product-drafts/' + draftId, 'PUT', {
            version: 0,
            content: {},
          })
        ).status,
        200,
      );
      const results = await Promise.all(
        [1, 2].map(() =>
          request(path() + '/product-drafts/' + draftId, 'PUT', {
            version: 1,
            content: content(),
          }),
        ),
      );
      assert.deepEqual(results.map((r) => r.status).sort(), [200, 409]);
      assert.equal(
        (
          await db.client
            .select()
            .from(products)
            .where(eq(products.shopId, shopA))
        ).length,
        0,
      );
    });
    void test('draft ownership and mass assignment fail closed', async () => {
      assert.equal(
        (
          await request(
            path() + '/product-drafts/' + draftId,
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
            '/shops/' + shopB + '/product-drafts/' + draftId,
            'PUT',
            { version: 2, content: content() },
            b,
          )
        ).status,
        404,
      );
      for (const injection of [
        { role: 'SUPER_ADMIN' },
        { shopId: shopB },
        { status: 'PUBLISHED' },
        { ownerId: b.principal.userId },
      ]) {
        assert.equal(
          (
            await request(path() + '/product-drafts/' + draftId, 'PUT', {
              version: 2,
              content: { ...content(), ...injection },
            })
          ).status,
          400,
        );
      }
      assert.equal(
        (
          await request(path() + '/product-drafts/' + draftId, 'PUT', {
            version: 2,
          })
        ).status,
        400,
      );
    });
    void test('concurrent materialization creates exactly one draft product', async () => {
      const responses = await Promise.all(
        [1, 2, 3].map(() =>
          request(
            path() + '/product-drafts/' + draftId + '/materialize',
            'POST',
            {},
          ),
        ),
      );
      const ids: string[] = [];
      for (const response of responses) {
        assert.equal(response.status, 201);
        const row = (await response.json()) as { id: string; status: string };
        ids.push(row.id);
        assert.equal(row.status, 'DRAFT');
      }
      assert.equal(new Set(ids).size, 1);
      productId = ids[0]!;
      assert.equal(
        (
          await db.client
            .select()
            .from(products)
            .where(eq(products.shopId, shopA))
        ).length,
        1,
      );
    });
    void test('duplicate has fresh id/slug, draft state and no analytics or images', async () => {
      await db.client.insert(analyticsEvents).values({
        eventId: randomUUID(),
        type: 'PRODUCT_VIEW',
        shopId: shopA,
        productId,
      });
      const response = await request(
        path() + '/products/' + productId + '/duplicate',
        'POST',
        {},
      );
      assert.equal(response.status, 201);
      const copy = (await response.json()) as {
        id: string;
        slug: string;
        status: string;
      };
      assert.notEqual(copy.id, productId);
      assert.equal(copy.status, 'DRAFT');
      assert.equal(
        (
          await db.client
            .select()
            .from(analyticsEvents)
            .where(eq(analyticsEvents.productId, copy.id))
        ).length,
        0,
      );
      assert.equal(
        (
          await db.client
            .select()
            .from(productImages)
            .where(eq(productImages.productId, copy.id))
        ).length,
        0,
      );
      assert.equal(
        (
          await request(
            '/shops/' + shopB + '/products/' + productId + '/duplicate',
            'POST',
            {},
            b,
          )
        ).status,
        404,
      );
    });
    void test('bulk actions are atomic and tenant scoped; publication requires photo', async () => {
      const body = { ids: [productId, randomUUID()], action: 'ARCHIVE' };
      assert.equal(
        (await request(path() + '/product-actions', 'POST', body)).status,
        404,
      );
      assert.equal(
        (
          await request(
            '/shops/' + shopB + '/product-actions',
            'POST',
            { ...body, ids: [productId] },
            b,
          )
        ).status,
        404,
      );
      assert.equal(
        (
          await request(path() + '/product-actions', 'POST', {
            ids: [productId],
            action: 'PUBLISH',
          })
        ).status,
        400,
      );
      const [row] = await db.client
        .select()
        .from(products)
        .where(eq(products.id, productId));
      assert.equal(row!.status, 'DRAFT');
      assert.equal(
        (
          await request(path() + '/product-actions', 'POST', {
            ids: [productId],
            action: 'AVAILABILITY',
            available: false,
          })
        ).status,
        201,
      );
    });
    void test('seller list search/status/count pagination and image-order isolation', async () => {
      const response = await request(
        path() +
          '/products?q=' +
          encodeURIComponent('Пальто') +
          '&status=DRAFT&limit=1',
      );
      assert.equal(response.status, 200);
      const list = (await response.json()) as { total: number }[];
      assert.equal(list.length, 1);
      assert.equal(list[0]!.total, 2);
      assert.equal(
        (
          await request(
            '/shops/' + shopB + '/products/' + productId + '/image-order',
            'PUT',
            { ids: [randomUUID()] },
            b,
          )
        ).status,
        404,
      );
      assert.equal(
        (
          await request(
            path() + '/products/' + productId + '/image-order',
            'PUT',
            { ids: [randomUUID()] },
          )
        ).status,
        400,
      );
    });
  },
);
