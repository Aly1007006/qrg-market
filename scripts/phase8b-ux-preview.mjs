// Isolated browser QA server. Never runs against the development/production database.
import { createRequire } from 'node:module';
import { randomBytes, randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { pathToFileURL } from 'node:url';
const requireApi = createRequire(
  new URL('../apps/api/package.json', import.meta.url),
);
const requireWeb = createRequire(
  new URL('../apps/web/package.json', import.meta.url),
);
await import(pathToFileURL(requireApi.resolve('reflect-metadata')).href);
const { NestFactory } = await import(
  pathToFileURL(requireApi.resolve('@nestjs/core')).href
);
const { eq, inArray, or } = await import(
  pathToFileURL(requireApi.resolve('drizzle-orm')).href
);
const { TOTP, Secret } = await import(
  pathToFileURL(requireApi.resolve('otpauth')).href
);
const { AppModule } = await import('../apps/api/dist/app.module.js');
const { loadConfig } = await import('../apps/api/dist/config.js');
const { configureApplication } = await import('../apps/api/dist/http.js');
const { Database } = await import('../apps/api/dist/database.js');
const { AuthService } = await import('../apps/api/dist/auth/service.js');
const { ShopsService } = await import('../apps/api/dist/shops/service.js');
const { SellerCatalogService } =
  await import('../apps/api/dist/catalogue/seller.service.js');
const { MediaService } = await import('../apps/api/dist/media/service.js');
const { ObjectStorage } = await import('../apps/api/dist/media/storage.js');
const { encryptTotp } = await import('../apps/api/dist/admin/security.js');
const schema = await import('../apps/api/dist/db/schema.js');
const config = loadConfig({
  ...process.env,
  NODE_ENV: 'test',
  APP_ORIGIN: 'http://127.0.0.1:43185',
});
if (!new URL(config.databaseUrl).pathname.endsWith('_test'))
  throw Error('Test database required');
const key = randomBytes(32);
process.env.ADMIN_MFA_ENCRYPTION_KEY = key.toString('base64');
const app = await NestFactory.create(AppModule.register(config), {
  bodyParser: false,
  logger: false,
});
await configureApplication(app, config);
await app.listen(0, '127.0.0.1');
const db = app.get(Database),
  auth = app.get(AuthService);
const cleanupRun =
  process.argv[2] === '--cleanup' ? process.argv[3] : undefined;
if (
  cleanupRun &&
  !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(
    cleanupRun,
  )
)
  throw Error('Invalid cleanup run');
const run = cleanupRun ?? randomUUID();
const ownerEmail = `ux-owner-${run}@example.test`,
  adminEmail = `ux-admin-${run}@example.test`;
const password = 'Disposable local UX fixture only!2026';
const emails = [ownerEmail, adminEmail];
let shopId, categoryId, child;
async function cleanup() {
  if (child && child.exitCode === null) {
    const ended = once(child, 'exit');
    child.kill();
    await ended;
  }
  if (shopId) {
    const objects = await db.client
      .select()
      .from(schema.mediaObjects)
      .where(
        or(
          eq(schema.mediaObjects.shopId, shopId),
          inArray(
            schema.mediaObjects.productId,
            db.client
              .select({ id: schema.products.id })
              .from(schema.products)
              .where(eq(schema.products.shopId, shopId)),
          ),
        ),
      );
    for (const object of objects)
      await app.get(ObjectStorage).remove(object.objectKey);
    for (const object of objects)
      await db.client
        .delete(schema.mediaObjects)
        .where(eq(schema.mediaObjects.objectKey, object.objectKey));
    await db.client
      .delete(schema.productDrafts)
      .where(eq(schema.productDrafts.shopId, shopId));
    await db.client.delete(schema.shops).where(eq(schema.shops.id, shopId));
  }
  await db.client
    .delete(schema.users)
    .where(inArray(schema.users.email, emails));
  if (categoryId)
    await db.client
      .delete(schema.categories)
      .where(eq(schema.categories.id, categoryId));
  await app.close();
}
if (cleanupRun) {
  const [owner] = await db.client
    .select()
    .from(schema.users)
    .where(eq(schema.users.email, ownerEmail));
  if (owner) {
    const [member] = await db.client
      .select()
      .from(schema.shopMembers)
      .where(eq(schema.shopMembers.userId, owner.id));
    shopId = member?.shopId;
  }
  const [category] = await db.client
    .select()
    .from(schema.categories)
    .where(eq(schema.categories.slug, 'ux-' + run));
  categoryId = category?.id;
  await cleanup();
  console.log('Named disposable UX fixtures removed from test database');
  process.exit(0);
}
try {
  await auth.signup(ownerEmail, password);
  await auth.signup(adminEmail, password);
  const owner = await auth.login(ownerEmail, password);
  const principal = await auth.authenticate(owner.token);
  shopId = (
    await app.get(ShopsService).create(principal, 'ТЕСТ — Бутик мобильного UX')
  ).id;
  const [category] = await db.client
    .insert(schema.categories)
    .values({ name: 'Тест: одежда', slug: 'ux-' + run })
    .returning();
  categoryId = category.id;
  const product = await app
    .get(SellerCatalogService)
    .create(principal, shopId, {
      name: 'ТЕСТ — Бежевый жакет',
      slug: 'ux-' + run,
      description: 'Только проверка интерфейса',
      categoryId,
      brandId: null,
      basePrice: 12000,
      oldPrice: null,
      status: 'DRAFT',
      variants: [
        {
          size: 'M',
          color: 'Бежевый',
          sku: null,
          priceOverride: null,
          available: true,
        },
      ],
    });
  const sharp = requireApi('sharp');
  const buffer = await sharp({
    create: { width: 300, height: 300, channels: 3, background: '#c9b28a' },
  })
    .png()
    .toBuffer();
  await app.get(MediaService).upload(principal, shopId, product.id, {
    buffer,
    size: buffer.length,
    mimetype: 'image/png',
  });
  const [admin] = await db.client
    .select()
    .from(schema.users)
    .where(eq(schema.users.email, adminEmail));
  const secret = new Secret({ size: 20 }).base32;
  await db.client.insert(schema.adminAccounts).values({
    userId: admin.id,
    role: 'SUPER_ADMIN',
    totpEncrypted: encryptTotp(secret, admin.id, key),
  });
  child = spawn(
    process.execPath,
    [
      requireWeb.resolve('next/dist/bin/next'),
      'start',
      '-H',
      '127.0.0.1',
      '-p',
      '43185',
    ],
    {
      cwd: new URL('../apps/web/', import.meta.url),
      env: {
        ...process.env,
        NODE_ENV: 'production',
        QRG_API_ORIGIN: await app.getUrl(),
        QRG_APP_ORIGIN: config.appOrigin,
        QRG_DEV_FIXTURES: 'false',
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    },
  );
  child.stdout.on('data', () => {});
  child.stderr.on('data', () => {});
  // Only disposable example.test credentials, never real users or production MFA keys.
  console.log(
    JSON.stringify({
      origin: config.appOrigin,
      ownerEmail,
      adminEmail,
      password,
      shopId,
    }),
  );
  const timer = setInterval(
    () =>
      console.log(
        JSON.stringify({ testAdminOtp: new TOTP({ secret }).generate() }),
      ),
    30000,
  );
  console.log(
    JSON.stringify({ testAdminOtp: new TOTP({ secret }).generate() }),
  );
  await new Promise((resolve) => {
    process.stdin.resume();
    process.stdin.on('data', (data) => {
      if (String(data).trim() === 'stop') resolve();
    });
    process.once('SIGINT', resolve);
    process.once('SIGTERM', resolve);
    child.once('exit', resolve);
  });
  clearInterval(timer);
  process.stdin.pause();
} finally {
  await cleanup();
}
