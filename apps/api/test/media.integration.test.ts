import 'reflect-metadata';
import { paidFixtures, removeBillingFixtures } from './billing-fixtures.js';
import { before, after, test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { once } from 'node:events';
import sharp from 'sharp';
import { Test } from '@nestjs/testing';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { and, eq, inArray } from 'drizzle-orm';
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
  shops,
  users,
  mediaObjects,
  productImages,
  shopMembers,
} from '../src/db/schema.js';
import { ObjectStorage } from '../src/media/storage.js';
import { cleanupMedia } from '../src/media/service.js';

const run = randomUUID();
const config = loadConfig({
  ...process.env,
  NODE_ENV: 'test',
  APP_ORIGIN: 'http://127.0.0.1:43185',
  AUTH_RATE_LIMIT_SECRET: run + '-media-test',
});
assert.ok(new URL(config.databaseUrl).pathname.endsWith('_test'));
assert.ok(
  process.env.S3_ENDPOINT,
  'Real local S3 endpoint required for media tests',
);
let app: NestExpressApplication;
let db: Database;
let base: string;
let shopA: string;
let shopB: string;
let productId: string;
let categoryId: string;
let buffer: Buffer;
let a: Awaited<ReturnType<AuthService['login']>>;
let b: typeof a;
const emails = [run + '-media-a@example.test', run + '-media-b@example.test'];
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
  const auth = app.get(AuthService);
  const tenant = app.get(ShopsService);
  const password = 'Media integration fixture password 2026!';
  await auth.signup(emails[0]!, password);
  await auth.signup(emails[1]!, password);
  a = await auth.login(emails[0]!, password);
  b = await auth.login(emails[1]!, password);
  const p = await auth.authenticate(a.token);
  shopA = (await tenant.create(p, 'Image test ' + run)).id;
  shopB = (
    await tenant.create(
      await auth.authenticate(b.token),
      'Other image test ' + run,
    )
  ).id;
  await paidFixtures(db, [shopA, shopB]);
  const [category] = await db.client
    .insert(categories)
    .values({ name: 'Media test', slug: 'media-' + run })
    .returning();
  categoryId = category!.id;
  const body = Object.assign(new ProductCreateDto(), {
    name: 'Media product',
    slug: 'media-' + run,
    categoryId,
    basePrice: 1000,
    variants: [new VariantDto()],
  });
  productId = (await app.get(SellerCatalogService).create(p, shopA, body)).id;
  buffer = await sharp({
    create: { width: 20, height: 20, channels: 3, background: 'red' },
  })
    .png()
    .toBuffer();
});
function path(shop = shopA) {
  return '/api/v1/shops/' + shop + '/products/' + productId + '/images';
}
async function upload(
  client: typeof a | undefined = a,
  shop = shopA,
  bytes = buffer,
  mime = 'image/png',
  extra?: string,
  csrf = true,
) {
  const form = new FormData();
  form.append(
    'file',
    new Blob([new Uint8Array(bytes)], { type: mime }),
    'untrusted-name.png',
  );
  if (extra) form.append(extra, shopB);
  return fetch(base + path(shop), {
    method: 'POST',
    headers: {
      origin: config.appOrigin,
      'x-qrg-client': 'web',
      ...(client
        ? {
            cookie: 'qrg_session=' + client.token,
            ...(csrf ? { 'x-qrg-csrf': client.csrfToken } : {}),
          }
        : {}),
    },
    body: form,
  });
}
async function image() {
  const r = await upload();
  assert.equal(r.status, 201, await r.clone().text());
  return (await r.json()) as { id: string; objectKey: string };
}
after(async () => {
  if (db && shopA && shopB) await removeBillingFixtures(db, [shopA, shopB]);
  if (db && productId) {
    const objects = await db.client
      .select()
      .from(mediaObjects)
      .where(eq(mediaObjects.productId, productId));
    for (const o of objects) await app.get(ObjectStorage).remove(o.objectKey);
    await db.client
      .delete(mediaObjects)
      .where(eq(mediaObjects.productId, productId));
  }
  if (db) {
    if (shopA && shopB)
      await db.client.delete(shops).where(inArray(shops.id, [shopA, shopB]));
    await db.client.delete(users).where(inArray(users.email, emails));
    if (categoryId)
      await db.client.delete(categories).where(eq(categories.id, categoryId));
  }
  await app?.close();
});
void test('multipart authorizes before parsing; rejects IDOR, forged fields and missing CSRF', async () => {
  assert.equal((await upload(b)).status, 404);
  assert.equal((await upload(a, shopB)).status, 404);
  assert.equal(
    (await upload(a, shopA, buffer, 'image/png', undefined, false)).status,
    403,
  );
  assert.equal(
    (await upload(a, shopA, buffer, 'image/png', 'shop_id')).status,
    400,
  );
});
void test('HTTP upload rejects malicious MIME/data and source >10 MB', async () => {
  for (const mime of ['image/svg+xml', 'text/html', 'application/octet-stream'])
    assert.equal(
      (await upload(a, shopA, Buffer.from('<svg/>'), mime)).status,
      415,
    );
  assert.equal((await upload(a, shopA, Buffer.from('<html/>'))).status, 415);
  assert.equal(
    (await upload(a, shopA, Buffer.alloc(10 * 1024 * 1024 + 1))).status,
    413,
  );
});
void test('real S3 round trip, private image authorization and public visibility', async () => {
  const img = await image();
  assert.match(
    img.objectKey,
    new RegExp('^products/' + productId + '/[0-9a-f-]{36}\\.webp$'),
  );
  const data = await app.get(ObjectStorage).read(img.objectKey);
  assert.equal((await sharp(data).metadata()).format, 'webp');
  const resource = base + path() + '/' + img.id + '/content';
  assert.equal((await fetch(resource)).status, 401);
  assert.equal(
    (await fetch(resource, { headers: { cookie: 'qrg_session=' + b.token } }))
      .status,
    404,
  );
  assert.equal(
    (await fetch(resource, { headers: { cookie: 'qrg_session=' + a.token } }))
      .status,
    200,
  );
  assert.equal(
    (await fetch(base + '/api/v1/public/images/' + img.id)).status,
    404,
  );
});
void test('10-image limit includes concurrent reservations', async () => {
  for (let i = 1; i < 9; i++) await image();
  const responses = await Promise.all([upload(), upload()]);
  assert.deepEqual(responses.map((r) => r.status).sort(), [201, 409]);
  assert.equal(
    (
      await db.client
        .select()
        .from(productImages)
        .where(eq(productImages.productId, productId))
    ).length,
    10,
  );
});
void test('image IDOR cannot delete; authorized removal queues durable cleanup', async () => {
  const [img] = await db.client
    .select()
    .from(productImages)
    .where(eq(productImages.productId, productId));
  assert.ok(img);
  const imageId = img.id;
  async function remove(client: typeof a) {
    return fetch(base + path() + '/' + imageId, {
      method: 'DELETE',
      headers: {
        origin: config.appOrigin,
        'x-qrg-client': 'web',
        'x-qrg-csrf': client.csrfToken,
        cookie: 'qrg_session=' + client.token,
        'content-type': 'application/json',
      },
      body: '{}',
    });
  }
  assert.equal((await remove(b)).status, 404);
  assert.equal((await remove(a)).status, 204);
  assert.equal(
    (
      await db.client
        .select()
        .from(mediaObjects)
        .where(
          and(
            eq(mediaObjects.objectKey, img.objectKey),
            eq(mediaObjects.state, 'DELETING'),
          ),
        )
    ).length,
    1,
  );
  const result = await cleanupMedia(db, app.get(ObjectStorage));
  assert.equal(result.removed, 1);
  await assert.rejects(app.get(ObjectStorage).read(img.objectKey));
  assert.equal(
    (
      await db.client
        .select()
        .from(productImages)
        .where(eq(productImages.productId, productId))
    ).length,
    9,
  );
});
void test('expired orphan intent cleans up while attached files remain untouched', async () => {
  const key = 'products/' + productId + '/' + randomUUID() + '.webp';
  await db.client.insert(mediaObjects).values({
    objectKey: key,
    productId,
    retryAt: new Date(Date.now() - 1000),
  });
  await app.get(ObjectStorage).put(key, buffer);
  assert.equal((await cleanupMedia(db, app.get(ObjectStorage))).removed, 1);
  await assert.rejects(app.get(ObjectStorage).read(key));
  assert.equal(
    (
      await db.client
        .select()
        .from(productImages)
        .where(eq(productImages.productId, productId))
    ).length,
    9,
  );
});
void test('membership revoked during S3 PUT cannot attach a previously authorized upload', async () => {
  const [member] = await db.client
    .insert(shopMembers)
    .values({ shopId: shopA, userId: b.user.id, role: 'SHOP_EMPLOYEE' })
    .returning();
  assert.ok(member);
  const storage = app.get(ObjectStorage);
  const put = storage.put.bind(storage);
  storage.put = async (key, bytes) => {
    await put(key, bytes);
    await db.client.delete(shopMembers).where(eq(shopMembers.id, member.id));
  };
  try {
    assert.equal((await upload(b)).status, 404);
  } finally {
    storage.put = put;
    await db.client.delete(shopMembers).where(eq(shopMembers.id, member.id));
  }
  const [intent] = await db.client
    .select()
    .from(mediaObjects)
    .where(
      and(
        eq(mediaObjects.productId, productId),
        eq(mediaObjects.state, 'PENDING'),
      ),
    );
  assert.ok(intent);
  await db.client
    .update(mediaObjects)
    .set({ retryAt: new Date(Date.now() - 1000) })
    .where(eq(mediaObjects.objectKey, intent.objectKey));
  assert.equal((await cleanupMedia(db, storage)).removed, 1);
  await assert.rejects(storage.read(intent.objectKey));
});

void test('ambiguous PUT failure leaves a durable intent and no product image', async () => {
  const storage = app.get(ObjectStorage);
  const put = storage.put.bind(storage);
  storage.put = async (key, bytes) => {
    await put(key, bytes);
    throw new Error('Simulated lost acknowledgement');
  };
  try {
    assert.equal((await upload()).status, 500);
  } finally {
    storage.put = put;
  }
  const [intent] = await db.client
    .select()
    .from(mediaObjects)
    .where(
      and(
        eq(mediaObjects.productId, productId),
        eq(mediaObjects.state, 'PENDING'),
      ),
    );
  assert.ok(intent);
  await db.client
    .update(mediaObjects)
    .set({ retryAt: new Date(Date.now() - 1000) })
    .where(eq(mediaObjects.objectKey, intent.objectKey));
  assert.equal((await cleanupMedia(db, storage)).removed, 1);
  await assert.rejects(storage.read(intent.objectKey));
});

if (process.env.QRG_TEST_BUILT_SELLER === 'true')
  void test('built seller SSR and BFF: login, CSRF, product editing, images and tenant isolation', async () => {
    const requireWeb = createRequire(resolve('../web/package.json'));
    const child = spawn(
      process.execPath,
      [
        requireWeb.resolve('next/dist/bin/next'),
        'start',
        '-p',
        '43185',
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
        if (child.exitCode !== null) throw new Error('Web exited');
        try {
          ready = (await fetch(origin + '/seller/login')).ok;
          if (ready) break;
        } catch {
          /* Retry startup until the bounded deadline. */
        }
        await new Promise((r) => setTimeout(r, 100));
      }
      assert.ok(ready);
      const anonymous = await fetch(origin + '/seller', { redirect: 'manual' });
      assert.equal(anonymous.status, 307);
      assert.equal(anonymous.headers.get('location'), '/seller/login');
      const login = await fetch(origin + '/api/seller/auth/login', {
        method: 'POST',
        headers: {
          origin,
          'content-type': 'application/json',
          'x-qrg-client': 'web',
        },
        body: JSON.stringify({
          email: emails[0],
          password: 'Media integration fixture password 2026!',
        }),
      });
      assert.equal(login.status, 200);
      const cookie = login.headers.getSetCookie()[0]?.split(';')[0];
      assert.ok(cookie);
      assert.match(login.headers.getSetCookie()[0] ?? '', /HttpOnly/);
      const auth = (await login.json()) as { csrfToken: string };
      const headers = {
        cookie,
        origin,
        'content-type': 'application/json',
        'x-qrg-client': 'web',
        'x-qrg-csrf': auth.csrfToken,
      };
      for (const section of [
        '',
        '/products',
        '/products/new',
        '/products/' + productId,
        '/shop',
        '/employees',
        '/settings',
        '/requests',
        '/subscription',
        '/statistics',
      ]) {
        const r: Response = await fetch(origin + '/seller/' + shopA + section, {
          headers: { cookie },
        });
        assert.equal(r.status, 200, section);
        assert.match(await r.text(), /noindex/);
      }
      const path = '/api/seller/shops/' + shopA + '/products/' + productId;
      const foreign = await fetch(
        origin + '/api/seller/shops/' + shopB + '/products',
        { headers: { cookie } },
      );
      assert.equal(foreign.status, 404);
      const body = {
        name: 'Edited via seller BFF',
        slug: 'media-' + run,
        categoryId,
        basePrice: 2000,
        status: 'DRAFT',
      };
      assert.equal(
        (
          await fetch(origin + path, {
            method: 'PUT',
            headers: { ...headers, origin: 'https://evil.test' },
            body: JSON.stringify(body),
          })
        ).status,
        403,
      );
      assert.equal(
        (
          await fetch(origin + path, {
            method: 'PUT',
            headers: { ...headers, 'x-qrg-csrf': '' },
            body: JSON.stringify(body),
          })
        ).status,
        403,
      );
      assert.equal(
        (
          await fetch(origin + path, {
            method: 'PUT',
            headers,
            body: JSON.stringify({ ...body, shop_id: shopB }),
          })
        ).status,
        400,
      );
      assert.equal(
        (
          await fetch(origin + path, {
            method: 'PUT',
            headers,
            body: JSON.stringify(body),
          })
        ).status,
        200,
      );
      const form = new FormData();
      form.append(
        'file',
        new Blob([new Uint8Array(buffer)], { type: 'image/png' }),
        'photo.png',
      );
      const uploaded = await fetch(origin + path + '/images', {
        method: 'POST',
        headers: {
          cookie,
          origin,
          'x-qrg-client': 'web',
          'x-qrg-csrf': auth.csrfToken,
        },
        body: form,
      });
      assert.equal(uploaded.status, 201, await uploaded.clone().text());
      const image = (await uploaded.json()) as { id: string };
      assert.equal(
        (
          await fetch(origin + path + '/images/' + image.id + '/content', {
            headers: { cookie },
          })
        ).status,
        200,
      );
      assert.equal(
        (await fetch(origin + '/api/images/' + image.id)).status,
        404,
      );
      assert.equal(
        (
          await fetch(origin + path, {
            method: 'PUT',
            headers,
            body: JSON.stringify({ ...body, status: 'PUBLISHED' }),
          })
        ).status,
        200,
      );
      await db.client
        .update(shops)
        .set({ status: 'ACTIVE' })
        .where(eq(shops.id, shopA));
      const publicImage = await fetch(origin + '/api/images/' + image.id);
      assert.equal(publicImage.status, 200);
      assert.equal(publicImage.headers.get('content-type'), 'image/webp');
      assert.equal(
        (
          await fetch(
            origin +
              '/_next/image?url=' +
              encodeURIComponent('/api/images/' + image.id) +
              '&w=640&q=75',
          )
        ).status,
        400,
      );
      assert.equal(
        (
          await fetch(origin + path, {
            method: 'PUT',
            headers,
            body: JSON.stringify({ ...body, status: 'ARCHIVED' }),
          })
        ).status,
        200,
      );
      assert.equal(
        (await fetch(origin + '/api/images/' + image.id)).status,
        404,
      );
    } finally {
      if (child.exitCode === null) {
        const exited = once(child, 'exit');
        child.kill();
        await exited;
      }
    }
  });
