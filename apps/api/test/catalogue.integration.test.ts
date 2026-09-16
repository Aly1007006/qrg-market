import 'reflect-metadata';
import { paidFixtures, removeBillingFixtures } from './billing-fixtures.js';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { createRequire } from 'node:module';
import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import { after, before, describe, test } from 'node:test';
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
import type { Principal } from '../src/auth/metadata.js';
import { ShopsService } from '../src/shops/service.js';
import {
  brands,
  categories,
  products,
  productVariants,
  productImages,
  shops,
  users,
  shopLocations,
  shopMembers,
} from '../src/db/schema.js';

interface Product {
  id: string;
  slug: string;
  name: string;
  price: number;
  variants: { id: string; price: number }[];
  shopDetails: { twoGisUrl: string | null };
}
interface Result {
  items: Product[];
  total: number;
  pages: number;
}
void describe(
  'PHASE 3 PostgreSQL catalog, search and tenant security',
  { concurrency: false },
  () => {
    const run = randomUUID();
    const config = loadConfig({
      ...process.env,
      NODE_ENV: 'test',
      SWAGGER_ENABLED: 'true',
      AUTH_RATE_LIMIT_SECRET: run + '-catalog-tests',
    });
    assert.ok(
      new URL(config.databaseUrl).pathname.endsWith('_test'),
      'Dedicated *_test database required',
    );
    let app: NestExpressApplication;
    let db: Database;
    let base: string;
    let a: { token: string; principal: Principal };
    let b: typeof a;
    let shopA: string;
    let shopB: string;
    let shopSlug: string;
    let brandId: string;
    let rootId: string;
    let childId: string;
    let pa: Product;
    let pb: Product;
    let pd: Product;
    let cheap: Product;
    const emails = [run + '-a@example.test', run + '-b@example.test'];
    const brandName = 'Марка ' + run;
    const rootSlug = 'root-' + run;
    const childSlug = 'child-' + run;
    const link = 'https://2gis.kz/karaganda/firm/70000001038483747';
    const productBody = (slug: string, status = 'PUBLISHED') => ({
      name: 'Кашемировое пальто ' + run,
      slug,
      categoryId: childId,
      brandId,
      description: 'Зимняя коллекция для прогулок',
      basePrice: 10000,
      oldPrice: 15000,
      status,
      variants: [
        { size: 'M', color: 'black', priceOverride: 3000, available: true },
        { size: 'L', color: 'white', priceOverride: 20000, available: false },
      ],
    });
    async function request(
      path: string,
      method = 'GET',
      client?: typeof a,
      body?: unknown,
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
                'x-qrg-csrf': client.principal.csrfToken,
              }
            : {}),
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
    }
    async function read<T>(response: Response, status = 200): Promise<T> {
      assert.equal(
        response.status,
        status,
        response.status === status ? '' : await response.clone().text(),
      );
      return response.json() as Promise<T>;
    }
    const catalog = (q: Record<string, string> = {}) =>
      request(
        '/public/catalog?' +
          new URLSearchParams({ shop: shopSlug, ...q }).toString(),
      ).then((r) => read<Result>(r));
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
      const password = 'Catalog fixture only password 2026!';
      await auth.signup(emails[0]!, password);
      await auth.signup(emails[1]!, password);
      const al = await auth.login(emails[0]!, password),
        bl = await auth.login(emails[1]!, password);
      a = { token: al.token, principal: await auth.authenticate(al.token) };
      b = { token: bl.token, principal: await auth.authenticate(bl.token) };
      shopA = (await tenant.create(a.principal, 'Бутик Север ' + run)).id;
      shopB = (await tenant.create(b.principal, 'Скрытый Бутик ' + run)).id;
      await paidFixtures(db, [shopA, shopB]);
      const [shop] = await db.client
        .update(shops)
        .set({ status: 'ACTIVE' })
        .where(eq(shops.id, shopA))
        .returning();
      shopSlug = shop!.slug;
      const [br] = await db.client
        .insert(brands)
        .values({ name: brandName, slug: 'brand-' + run })
        .returning();
      brandId = br!.id;
      const [root] = await db.client
        .insert(categories)
        .values({ name: 'Зимняя одежда', slug: rootSlug })
        .returning();
      rootId = root!.id;
      const [child] = await db.client
        .insert(categories)
        .values({ name: 'Пальто', slug: childSlug, parentId: rootId })
        .returning();
      childId = child!.id;
      pa = await read<Product>(
        await request(
          '/shops/' + shopA + '/products',
          'POST',
          a,
          productBody('coat-' + run),
        ),
        201,
      );
      pb = await read<Product>(
        await request(
          '/shops/' + shopB + '/products',
          'POST',
          b,
          productBody('hidden-' + run),
        ),
        201,
      );
      pd = await read<Product>(
        await request(
          '/shops/' + shopA + '/products',
          'POST',
          a,
          productBody('draft-' + run, 'DRAFT'),
        ),
        201,
      );
      cheap = await read<Product>(
        await request('/shops/' + shopA + '/products', 'POST', a, {
          ...productBody('cheap-' + run),
          name: 'Лёгкая куртка ' + run,
          basePrice: 5000,
          oldPrice: null,
          variants: [{ size: 'S', color: 'black', available: true }],
        }),
        201,
      );
    });
    after(async () => {
      if (db) {
        if (shopA && shopB) await removeBillingFixtures(db, [shopA, shopB]);
        if (shopA && shopB)
          await db.client
            .delete(shops)
            .where(inArray(shops.id, [shopA, shopB]));
        await db.client.delete(users).where(inArray(users.email, emails));
        if (childId)
          await db.client.delete(categories).where(eq(categories.id, childId));
        if (rootId)
          await db.client.delete(categories).where(eq(categories.id, rootId));
        if (brandId)
          await db.client.delete(brands).where(eq(brands.id, brandId));
      }
      if (app) await app.close();
    });
    void test('public catalog only exposes published products of ACTIVE shops', async () => {
      const data = await catalog();
      assert.equal(data.total, 2);
      assert.deepEqual(
        new Set(data.items.map((p) => p.slug)),
        new Set([pa.slug, cheap.slug]),
      );
      await read(await request('/public/products/' + pb.slug), 404);
      await read(await request('/public/products/' + pd.slug), 404);
      const [hiddenShop] = await db.client
        .select()
        .from(shops)
        .where(eq(shops.id, shopB));
      await read(await request('/public/shops/' + hiddenShop!.slug), 404);
      const suggestions = await read<{ slug: string }[]>(
        await request(
          '/public/search/suggestions?q=' + encodeURIComponent(run),
        ),
      );
      assert.ok(
        !suggestions.some((p) => p.slug === pb.slug || p.slug === pd.slug),
      );
    });
    void test('same variant satisfies all filters; override price is shown and sorted', async () => {
      assert.equal((await catalog({ size: 'M', color: 'white' })).total, 0);
      assert.equal(
        (
          await catalog({
            size: 'M',
            color: 'black',
            availability: 'available',
            priceMax: '3000',
            category: rootSlug,
            subcategory: childSlug,
            brand: brandName,
          })
        ).items[0]?.price,
        3000,
      );
      assert.equal(
        (await catalog({ size: 'L', availability: 'available' })).total,
        0,
      );
      assert.equal((await catalog({ size: 'L', discount: 'true' })).total, 0);
      assert.equal(
        (await catalog({ size: 'L', priceMin: '20000' })).items[0]?.price,
        20000,
      );
      assert.equal((await catalog({ discount: 'true' })).total, 1);
      assert.equal(
        (await catalog({ sort: 'price-asc' })).items[0]?.slug,
        pa.slug,
      );
      assert.equal(
        (await catalog({ sort: 'price-desc' })).items[0]?.slug,
        cheap.slug,
      );
      await read(
        await request('/public/catalog?priceMin=100&priceMax=10'),
        400,
      );
    });
    void test('pagination is stable and bounded; reference endpoints and shop products work', async () => {
      const first = await catalog({ limit: '1', page: '1' });
      const second = await catalog({ limit: '1', page: '2' });
      assert.equal(first.pages, 2);
      assert.notEqual(first.items[0]?.slug, second.items[0]?.slug);
      assert.equal((await catalog({ limit: '1', page: '3' })).items.length, 0);
      for (const query of [
        'limit=101',
        'page=0',
        'page=1.2',
        'sort=random()',
        'shop_id=other',
      ])
        await read(await request('/public/catalog?' + query), 400);
      assert.ok(
        (
          await read<{ id: string }[]>(await request('/public/categories'))
        ).some((c) => c.id === rootId),
      );
      assert.ok(
        (
          await read<{ id: string }[]>(
            await request('/public/brands?limit=100'),
          )
        ).some((c) => c.id === brandId),
      );
      assert.equal(
        (
          await read<Result>(
            await request('/public/shops/' + shopSlug + '/products'),
          )
        ).total,
        2,
      );
    });
    void test('FTS stemming, typo search, shop/brand/category names and SQL injection safety', async () => {
      for (const q of [
        'кашемировый',
        'кашемирвое',
        'Север',
        brandName,
        'Пальто',
        'прогулок',
      ])
        assert.ok(
          (await catalog({ q })).items.some((p) => p.slug === pa.slug),
          q,
        );
      assert.equal((await catalog({ q: "' OR 1=1 --" })).total, 0);
      assert.equal((await catalog({ q: '%_' })).total, 0);
      assert.equal((await catalog({ q: 'несуществующийтовар' })).total, 0);
    });
    void test('renaming related records refreshes the indexed search document', async () => {
      await db.client
        .update(brands)
        .set({ name: 'Уникальнаямарка ' + run })
        .where(eq(brands.id, brandId));
      assert.equal((await catalog({ q: 'уникальнаямарка' })).total, 2);
      await db.client
        .update(brands)
        .set({ name: brandName })
        .where(eq(brands.id, brandId));
      await db.client
        .update(shops)
        .set({ name: 'Северныйренейм ' + run })
        .where(eq(shops.id, shopA));
      assert.equal((await catalog({ q: 'северныйренейм' })).total, 2);
    });
    void test('seller A cannot read/update/create products for shop B (IDOR/BOLA)', async () => {
      for (const [path, method, body] of [
        ['/shops/' + shopB + '/products', 'GET', undefined],
        ['/shops/' + shopB + '/products', 'POST', productBody('attack-' + run)],
        ['/shops/' + shopA + '/products/' + pb.id, 'GET', undefined],
        [
          '/shops/' + shopA + '/products/' + pb.id,
          'PUT',
          productBody('attack-' + run),
        ],
      ] as const) {
        const validBody =
          method === 'PUT' && body
            ? Object.fromEntries(
                Object.entries(body).filter(([key]) => key !== 'variants'),
              )
            : body;
        await read(await request(path, method, a, validBody), 404);
      }
      await read(
        await request(
          '/shops/' + shopA + '/products',
          'POST',
          undefined,
          productBody('anon-' + run),
        ),
        401,
      );
      for (const field of [
        'shop_id',
        'shopId',
        'owner_id',
        'ownerId',
        'role',
        'permissions',
        'member_id',
      ])
        await read(
          await request('/shops/' + shopA + '/products', 'POST', a, {
            ...productBody('attack-' + run),
            [field]: shopB,
          }),
          400,
        );
    });
    void test('staff product permissions remain shop-scoped and revocation is immediate', async () => {
      for (const role of ['SHOP_MANAGER', 'SHOP_EMPLOYEE'] as const) {
        const [membership] = await db.client
          .insert(shopMembers)
          .values({ shopId: shopA, userId: b.principal.userId, role })
          .returning();
        try {
          const created = await read<Product>(
            await request(
              '/shops/' + shopA + '/products',
              'POST',
              b,
              productBody(
                role.toLowerCase().replaceAll('_', '-') + '-' + run,
                'DRAFT',
              ),
            ),
            201,
          );
          await read(
            await request(
              '/shops/' + shopA + '/products/' + created.id,
              'GET',
              b,
            ),
          );
          await read(
            await request('/shops/' + shopA + '/location', 'PUT', b, {
              address: 'Подмена сотрудником',
            }),
            403,
          );
        } finally {
          await db.client
            .delete(shopMembers)
            .where(eq(shopMembers.id, membership!.id));
        }
        await read(
          await request('/shops/' + shopA + '/products/' + pa.id, 'GET', b),
          404,
        );
      }
    });
    void test('failed nested product writes roll back; CSRF and constraints stay enabled', async () => {
      const body = productBody('duplicate-variants-' + run);
      await read(
        await request('/shops/' + shopA + '/products', 'POST', a, {
          ...body,
          variants: [body.variants[0], body.variants[0]],
        }),
        409,
      );
      assert.equal(
        (
          await db.client
            .select()
            .from(products)
            .where(eq(products.slug, body.slug))
        ).length,
        0,
      );
      await read(
        await request('/shops/' + shopA + '/products', 'POST', a, {
          ...body,
          variants: [],
        }),
        400,
      );
      await read(
        await fetch(base + '/api/v1/shops/' + shopA + '/products', {
          method: 'POST',
          headers: {
            cookie: 'qrg_session=' + a.token,
            origin: config.appOrigin,
            'x-qrg-client': 'web',
            'content-type': 'application/json',
          },
          body: JSON.stringify(body),
        }),
        403,
      );
    });
    void test('variant IDOR cannot mutate another product or another shop', async () => {
      const foreign = await read<Product>(
        await request('/shops/' + shopB + '/products/' + pb.id, 'GET', b),
      );
      await read(
        await request(
          '/shops/' +
            shopA +
            '/products/' +
            pa.id +
            '/variants/' +
            foreign.variants[0]!.id,
          'PUT',
          a,
          { size: 'M', available: false },
        ),
        404,
      );
      const own = await read<Product>(
        await request('/shops/' + shopA + '/products/' + cheap.id, 'GET', a),
      );
      await read(
        await request(
          '/shops/' +
            shopA +
            '/products/' +
            pa.id +
            '/variants/' +
            own.variants[0]!.id,
          'PUT',
          a,
          { size: 'M', available: false },
        ),
        404,
      );
    });
    void test('location links are canonical, owner-scoped, validated in API and DB', async () => {
      // PHASE 6: reviewed identity is locked. Exercise edits before verification,
      // then restore this suite's explicitly published fixture for public checks.
      await db.client
        .update(shops)
        .set({ status: 'DRAFT' })
        .where(eq(shops.id, shopA));
      await read(
        await request('/shops/' + shopA + '/location', 'PUT', a, {
          address: 'Тестовый адрес',
          mall: 'ТЦ тест ' + run,
          twoGisUrl: link + '/',
          latitude: 49.8,
          longitude: 73.1,
        }),
      );
      await read(
        await request('/shops/' + shopB + '/location', 'PUT', a, {
          address: 'Подмена',
        }),
        404,
      );
      for (const value of [
        link + '?url=https://evil.test',
        'https://2gis.kz.evil.test/firm/1',
        'javascript:alert(1)',
      ])
        await read(
          await request('/shops/' + shopA + '/location', 'PUT', a, {
            address: 'Адрес',
            twoGisUrl: value,
          }),
          400,
        );
      await read(
        await request('/shops/' + shopA + '/location', 'PUT', a, {
          address: 'Адрес',
          latitude: 49,
        }),
        400,
      );
      await assert.rejects(
        db.client
          .update(shopLocations)
          .set({ twoGisUrl: 'https://evil.test' })
          .where(eq(shopLocations.shopId, shopA)),
      );
      const geometry = await db.client.execute<{ srid: number }>(
        sql`SELECT ST_SRID(geo) AS srid FROM shop_locations WHERE shop_id=${shopA}`,
      );
      assert.equal(geometry.rows[0]?.srid, 4326);
      await db.client
        .update(shops)
        .set({ status: 'ACTIVE' })
        .where(eq(shops.id, shopA));
      const product = await read<Product>(
        await request('/public/products/' + pa.slug),
      );
      assert.equal(product.shopDetails.twoGisUrl, link);
      assert.equal((await catalog({ mall: 'ТЦ тест ' + run })).total, 2);
    });
    void test('constraints prevent cross-shop variants, negative prices, bad media keys and >10 images', async () => {
      await assert.rejects(
        db.client
          .insert(productVariants)
          .values({ productId: pa.id, shopId: shopB, size: 'XXL' }),
      );
      await assert.rejects(
        db.client
          .update(products)
          .set({ basePrice: -1 })
          .where(eq(products.id, pa.id)),
      );
      await assert.rejects(
        db.client
          .insert(categories)
          .values({ slug: 'deep-' + run, name: 'Deep', parentId: childId }),
      );
      const image = {
        productId: pa.id,
        objectKey: 'products/' + pa.id + '/' + randomUUID() + '.webp',
        position: 0,
        width: 100,
        height: 100,
      };
      await db.client.insert(productImages).values(image);
      await assert.rejects(
        db.client.insert(productImages).values({
          ...image,
          objectKey: 'products/' + pa.id + '/' + randomUUID() + 'xwebp',
          position: 1,
        }),
      );
      await assert.rejects(
        db.client.insert(productImages).values({
          ...image,
          objectKey: 'products/' + pa.id + '/' + randomUUID() + '.webp',
          position: 10,
        }),
      );
      await assert.rejects(
        db.client.insert(productImages).values({
          ...image,
          objectKey: 'https://evil.test/image.svg',
          position: 1,
        }),
      );
    });
    void test('suspension immediately hides detail/catalog/suggestions without deleting data', async () => {
      await db.client
        .update(shops)
        .set({ status: 'SUSPENDED' })
        .where(eq(shops.id, shopA));
      assert.equal((await catalog()).total, 0);
      await read(await request('/public/products/' + pa.slug), 404);
      assert.equal(
        (
          await read<{ slug: string }[]>(
            await request(
              '/public/search/suggestions?q=' + encodeURIComponent(run),
            ),
          )
        ).length,
        0,
      );
      assert.ok(
        await read(
          await request('/shops/' + shopA + '/products/' + pa.id, 'GET', a),
        ),
      );
      await db.client
        .update(shops)
        .set({ status: 'ACTIVE' })
        .where(eq(shops.id, shopA));
      assert.equal((await catalog()).total, 2);
    });
    if (process.env.QRG_TEST_BUILT_WEB === 'true')
      void test('built Next SSR reads real API records, filters, 2GIS and suggestions without fixture fallback', async () => {
        const webRequire = createRequire(resolve('../web/package.json'));
        const child = spawn(
          process.execPath,
          [
            webRequire.resolve('next/dist/bin/next'),
            'start',
            '-p',
            '43184',
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
              QRG_DEV_FIXTURES: 'true',
              QRG_SITE_URL: 'https://qrg.example.test',
              QRG_MEDIA_ORIGIN: '',
            },
          },
        );
        child.stdout.on('data', () => {});
        child.stderr.on('data', () => {});
        const origin = 'http://127.0.0.1:43184';
        try {
          let ready = false;
          for (let i = 0; i < 100; i++) {
            if (child.exitCode !== null) throw new Error('Built web exited');
            try {
              const response = await fetch(origin);
              assert.equal(response.status, 200);
              ready = true;
              break;
            } catch {
              await new Promise((resolve) => setTimeout(resolve, 100));
            }
          }
          assert.ok(ready, 'Built web readiness');
          const detail = await fetch(origin + '/product/' + pa.slug);
          assert.equal(detail.status, 200);
          const html = await detail.text();
          assert.ok(html.includes(pa.slug));
          assert.ok(html.includes(link));
          assert.ok(html.includes('Найти в 2GIS'));
          assert.ok(!html.includes('Демонстрационный товар'));
          assert.ok(!html.includes('/dev-fixtures/'));
          const shop = await fetch(origin + '/shop/' + shopSlug);
          assert.equal(shop.status, 200);
          assert.ok((await shop.text()).includes(link));
          const catalogPage = await fetch(
            origin + '/catalog?shop=' + shopSlug + '&size=L&priceMin=20000',
          );
          const catalogHtml = await catalogPage.text();
          assert.ok(catalogHtml.includes(pa.slug));
          assert.ok(!catalogHtml.includes(cheap.slug));
          assert.ok(!catalogHtml.includes(pb.slug));
          const suggestions = await fetch(
            origin + '/api/search?q=' + encodeURIComponent('кашемировое'),
          );
          const items = (await suggestions.json()) as { slug: string }[];
          assert.ok(items.some((p) => p.slug === pa.slug));
          assert.ok(!items.some((p) => p.slug === pb.slug));
          for (const slug of [pb.slug, pd.slug])
            assert.equal(
              (
                await fetch(origin + '/product/' + slug, {
                  headers: { 'user-agent': 'Googlebot' },
                })
              ).status,
              404,
            );
          await db.client
            .update(shops)
            .set({ status: 'SUSPENDED' })
            .where(eq(shops.id, shopA));
          assert.equal(
            (
              await fetch(origin + '/product/' + pa.slug, {
                headers: { 'user-agent': 'Googlebot' },
              })
            ).status,
            404,
          );
          await db.client
            .update(shops)
            .set({ status: 'ACTIVE' })
            .where(eq(shops.id, shopA));
        } finally {
          if (child.exitCode === null) {
            const exited = once(child, 'exit');
            child.kill();
            await exited;
          }
        }
      });
    void test('GIN search and GiST location indexes exist and FTS plan can use the index', async () => {
      const result = await db.client.execute<{ indexname: string }>(
        sql`SELECT indexname FROM pg_indexes WHERE indexname IN ('products_fts_idx','products_trgm_idx','locations_geo_idx')`,
      );
      assert.equal(result.rows.length, 3);
      await db.client.transaction(async (tx) => {
        await tx.execute(sql`SET LOCAL enable_seqscan=off`);
        const plan = await tx.execute(
          sql`EXPLAIN SELECT id FROM products WHERE search_vector @@ plainto_tsquery('russian','пальто')`,
        );
        assert.match(JSON.stringify(plan.rows), /products_fts_idx/);
      });
    });
  },
);
