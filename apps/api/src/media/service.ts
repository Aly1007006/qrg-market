import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { and, eq, sql } from 'drizzle-orm';
import { ShopAuthorization } from '../authorization/shop-authorization.js';
import type { Principal } from '../auth/metadata.js';
import { Database, type Transaction } from '../database.js';
import {
  mediaObjects,
  productImages,
  products,
  shops,
  shopImages,
} from '../db/schema.js';
import { requireEditableShopIdentity } from '../admin/moderation.js';
import { ObjectStorage } from './storage.js';
import { subscriptionVisible } from '../subscriptions/visibility.js';
import { processImage, type UploadedImage } from './processor.js';

async function product(tx: Transaction, shopId: string, id: string) {
  const [row] = await tx
    .select()
    .from(products)
    .where(and(eq(products.id, id), eq(products.shopId, shopId)));
  if (!row) throw new NotFoundException();
  return row;
}
@Injectable()
export class MediaService {
  constructor(
    @Inject(ShopAuthorization)
    private readonly authorization: ShopAuthorization,
    @Inject(Database) private readonly db: Database,
    @Inject(ObjectStorage) private readonly storage: ObjectStorage,
  ) {}
  shopPreflight(p: Principal, shop: string) {
    return this.authorization.withShop(
      p,
      shop,
      'shop.settings.write',
      (_tx, verified) => {
        requireEditableShopIdentity(verified.status);
        return Promise.resolve(verified.id);
      },
    );
  }
  async uploadShop(
    p: Principal,
    shop: string,
    kind: 'logo' | 'cover',
    file: UploadedImage | undefined,
  ) {
    await this.shopPreflight(p, shop);
    const image = await processImage(file);
    const key = `shops/${shop}/${randomUUID()}.webp`;
    await this.authorization.withShop(
      p,
      shop,
      'shop.settings.write',
      async (tx, verified) => {
        requireEditableShopIdentity(verified.status);
        const pending = await tx
          .select()
          .from(mediaObjects)
          .where(
            and(
              eq(mediaObjects.shopId, shop),
              eq(mediaObjects.state, 'PENDING'),
            ),
          );
        if (pending.length >= 2) throw new ConflictException();
        await tx.insert(mediaObjects).values({
          objectKey: key,
          shopId: shop,
          retryAt: new Date(Date.now() + 3600000),
        });
      },
    );
    await this.storage.put(key, image.bytes);
    return this.authorization.withShop(
      p,
      shop,
      'shop.settings.write',
      async (tx, verified) => {
        requireEditableShopIdentity(verified.status);
        const [intent] = await tx
          .select()
          .from(mediaObjects)
          .where(eq(mediaObjects.objectKey, key))
          .for('update');
        if (
          !intent ||
          intent.state !== 'PENDING' ||
          intent.retryAt <= new Date()
        )
          throw new ConflictException();
        const [old] = await tx
          .select()
          .from(shopImages)
          .where(and(eq(shopImages.shopId, shop), eq(shopImages.kind, kind)));
        const [result] = await tx
          .insert(shopImages)
          .values({
            shopId: shop,
            kind,
            objectKey: key,
            width: image.width,
            height: image.height,
          })
          .onConflictDoUpdate({
            target: [shopImages.shopId, shopImages.kind],
            set: {
              objectKey: key,
              width: image.width,
              height: image.height,
              updatedAt: new Date(),
            },
          })
          .returning({ id: shopImages.id, kind: shopImages.kind });
        await tx
          .update(mediaObjects)
          .set({ state: 'ATTACHED' })
          .where(eq(mediaObjects.objectKey, key));
        if (old)
          await tx
            .update(mediaObjects)
            .set({ state: 'DELETING', retryAt: new Date() })
            .where(eq(mediaObjects.objectKey, old.objectKey));
        return result;
      },
    );
  }
  async readShop(p: Principal, shop: string, kind: 'logo' | 'cover') {
    const key = await this.authorization.withShop(
      p,
      shop,
      'shop.read',
      async (tx) => {
        const [image] = await tx
          .select()
          .from(shopImages)
          .where(and(eq(shopImages.shopId, shop), eq(shopImages.kind, kind)));
        if (!image) throw new NotFoundException();
        return image.objectKey;
      },
    );
    return this.storage.read(key);
  }
  preflight(p: Principal, shop: string, id: string) {
    return this.authorization.withShop(
      p,
      shop,
      'products.write',
      (tx, verified) => product(tx, verified.id, id),
    );
  }
  async upload(
    p: Principal,
    shop: string,
    id: string,
    file: UploadedImage | undefined,
  ) {
    await this.preflight(p, shop, id);
    const image = await processImage(file);
    const key = `products/${id}/${randomUUID()}.webp`;
    await this.authorization.withShop(
      p,
      shop,
      'products.write',
      async (tx, verified) => {
        await product(tx, verified.id, id);
        const images = await tx
          .select()
          .from(productImages)
          .where(eq(productImages.productId, id));
        const pending = await tx
          .select()
          .from(mediaObjects)
          .where(
            and(
              eq(mediaObjects.productId, id),
              eq(mediaObjects.state, 'PENDING'),
            ),
          );
        if (images.length + pending.length >= 10)
          throw new ConflictException(
            'Maximum 10 images; retry after pending uploads finish',
          );
        await tx.insert(mediaObjects).values({
          objectKey: key,
          productId: id,
          retryAt: new Date(Date.now() + 3600000),
        });
      },
    );
    // The intent is committed BEFORE PUT. Failed/uncertain PUTs remain recoverable by cleanup.
    await this.storage.put(key, image.bytes);
    return this.authorization.withShop(
      p,
      shop,
      'products.write',
      async (tx, verified) => {
        const row = await product(tx, verified.id, id);
        const [intent] = await tx
          .select()
          .from(mediaObjects)
          .where(eq(mediaObjects.objectKey, key))
          .for('update');
        if (
          !intent ||
          intent.state !== 'PENDING' ||
          intent.retryAt <= new Date()
        )
          throw new ConflictException();
        const images = await tx
          .select()
          .from(productImages)
          .where(eq(productImages.productId, id));
        const position = Array.from({ length: 10 }, (_, i) => i).find(
          (i) => !images.some((img) => img.position === i),
        );
        if (position === undefined) throw new ConflictException();
        const [result] = await tx
          .insert(productImages)
          .values({
            productId: id,
            objectKey: key,
            alt: row.name,
            position,
            width: image.width,
            height: image.height,
          })
          .returning();
        await tx
          .update(mediaObjects)
          .set({ state: 'ATTACHED' })
          .where(eq(mediaObjects.objectKey, key));
        return result;
      },
    );
  }
  remove(p: Principal, shop: string, id: string, imageId: string) {
    return this.authorization.withShop(
      p,
      shop,
      'products.write',
      async (tx, verified) => {
        await product(tx, verified.id, id);
        const [image] = await tx
          .delete(productImages)
          .where(
            and(eq(productImages.id, imageId), eq(productImages.productId, id)),
          )
          .returning();
        if (!image) throw new NotFoundException();
        await tx
          .insert(mediaObjects)
          .values({
            objectKey: image.objectKey,
            productId: id,
            state: 'DELETING',
            retryAt: new Date(),
          })
          .onConflictDoUpdate({
            target: mediaObjects.objectKey,
            set: { state: 'DELETING', retryAt: new Date() },
          });
      },
    );
  }
  async read(p: Principal, shop: string, id: string, imageId: string) {
    const key = await this.authorization.withShop(
      p,
      shop,
      'products.read',
      async (tx, verified) => {
        await product(tx, verified.id, id);
        const [image] = await tx
          .select()
          .from(productImages)
          .where(
            and(eq(productImages.id, imageId), eq(productImages.productId, id)),
          );
        if (!image) throw new NotFoundException();
        return image.objectKey;
      },
    );
    return this.storage.read(key);
  }
  async publicRead(imageId: string) {
    const [image] = await this.db.client
      .select({ key: productImages.objectKey })
      .from(productImages)
      .innerJoin(products, eq(products.id, productImages.productId))
      .innerJoin(shops, eq(shops.id, products.shopId))
      .where(
        and(
          eq(productImages.id, imageId),
          eq(products.status, 'PUBLISHED'),
          eq(shops.status, 'ACTIVE'),
          subscriptionVisible(shops.id),
        ),
      );
    if (image) return this.storage.read(image.key);
    const [branding] = await this.db.client
      .select({ key: shopImages.objectKey })
      .from(shopImages)
      .innerJoin(shops, eq(shops.id, shopImages.shopId))
      .where(
        and(
          eq(shopImages.id, imageId),
          eq(shops.status, 'ACTIVE'),
          subscriptionVisible(shops.id),
        ),
      );
    if (!branding) throw new NotFoundException();
    return this.storage.read(branding.key);
  }
}

/** Bounded, retryable cleanup. No bucket-wide deletes; only durable, unreferenced intents. */
export async function cleanupMedia(
  db: Database,
  storage: ObjectStorage,
  limit = 50,
) {
  if (!Number.isInteger(limit) || limit < 1 || limit > 100)
    throw new BadRequestException();
  let removed = 0;
  for (let i = 0; i < limit; i++) {
    const key = await db.client.transaction(async (tx) => {
      const result = await tx.execute<{ object_key: string }>(sql`
        SELECT m.object_key FROM media_objects m
        WHERE m.retry_at <= now() AND NOT EXISTS (SELECT 1 FROM product_images i WHERE i.object_key = m.object_key) AND NOT EXISTS (SELECT 1 FROM shop_images i WHERE i.object_key=m.object_key)
        ORDER BY m.retry_at LIMIT 1 FOR UPDATE SKIP LOCKED`);
      const row = result.rows[0];
      if (!row) return undefined;
      await tx
        .update(mediaObjects)
        .set({ state: 'DELETING', retryAt: new Date(Date.now() + 3600000) })
        .where(eq(mediaObjects.objectKey, row.object_key));
      return row.object_key;
    });
    if (!key) break;
    await storage.remove(key);
    await db.client
      .delete(mediaObjects)
      .where(
        and(
          eq(mediaObjects.objectKey, key),
          eq(mediaObjects.state, 'DELETING'),
        ),
      );
    removed++;
  }
  return { removed };
}
