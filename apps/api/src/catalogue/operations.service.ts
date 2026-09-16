import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { and, eq, inArray, desc, sql } from 'drizzle-orm';
import { ShopAuthorization } from '../authorization/shop-authorization.js';
import type { Principal } from '../auth/metadata.js';
import {
  productDrafts,
  products,
  productVariants,
  productImages,
  sellerOnboarding,
  shopContacts,
  shopLocations,
  shopImages,
} from '../db/schema.js';
import { ProductCreateDto } from './dto.js';
import { SellerCatalogService, catalogWrite } from './seller.service.js';
import type {
  BulkProductDto,
  DraftSaveDto,
  ImageOrderDto,
  OnboardingDto,
} from './operations.dto.js';

@Injectable()
export class SellerOperationsService {
  constructor(
    @Inject(ShopAuthorization)
    private readonly authorization: ShopAuthorization,
    @Inject(SellerCatalogService)
    private readonly catalog: SellerCatalogService,
  ) {}

  onboarding(p: Principal, shopId: string) {
    return this.authorization.withShop(
      p,
      shopId,
      'shop.read',
      async (tx, shop) => {
        const [progress] = await tx
          .select()
          .from(sellerOnboarding)
          .where(
            and(
              eq(sellerOnboarding.shopId, shopId),
              eq(sellerOnboarding.userId, p.userId),
            ),
          );
        const [contacts] = await tx
          .select()
          .from(shopContacts)
          .where(eq(shopContacts.shopId, shopId));
        const [location] = await tx
          .select()
          .from(shopLocations)
          .where(eq(shopLocations.shopId, shopId));
        const images = await tx
          .select({ kind: shopImages.kind, id: shopImages.id })
          .from(shopImages)
          .where(eq(shopImages.shopId, shopId));
        const [count] = await tx
          .select({ count: sql<number>`count(*)::integer` })
          .from(products)
          .where(eq(products.shopId, shopId));
        const checklist = {
          name: Boolean(shop.name.trim()),
          logo: images.some((i) => i.kind === 'logo'),
          cover: images.some((i) => i.kind === 'cover'),
          whatsapp: Boolean(contacts?.whatsappPhone),
          twoGis: Boolean(location?.twoGisUrl),
          firstProduct: (count?.count ?? 0) >= 1,
          fiveProducts: (count?.count ?? 0) >= 5,
        };
        return {
          checklist,
          percent: Math.round(
            (Object.values(checklist).filter(Boolean).length / 7) * 100,
          ),
          skipped: progress?.skipped ?? false,
          reviewed: Boolean(progress?.reviewedAt),
          completed:
            Object.entries(checklist)
              .filter(([key]) => key !== 'fiveProducts')
              .every(([, done]) => done) && Boolean(progress?.reviewedAt),
          images,
          productCount: count?.count ?? 0,
          shopSlug: shop.slug,
          status: shop.status,
        };
      },
    );
  }
  saveOnboarding(p: Principal, shopId: string, body: OnboardingDto) {
    return this.authorization.withShop(
      p,
      shopId,
      'shop.settings.write',
      async (tx) => {
        const data =
          body.action === 'REVIEW'
            ? { reviewedAt: new Date() }
            : { skipped: body.action === 'SKIP' };
        await tx
          .insert(sellerOnboarding)
          .values({ shopId, userId: p.userId, ...data })
          .onConflictDoUpdate({
            target: [sellerOnboarding.shopId, sellerOnboarding.userId],
            set: { ...data, updatedAt: new Date() },
          });
        return { saved: true };
      },
    );
  }

  drafts(p: Principal, shopId: string) {
    return this.authorization.withShop(p, shopId, 'products.read', (tx) =>
      tx
        .select({
          id: productDrafts.id,
          content: productDrafts.content,
          version: productDrafts.version,
          updatedAt: productDrafts.updatedAt,
          productId: productDrafts.productId,
        })
        .from(productDrafts)
        .where(
          and(
            eq(productDrafts.shopId, shopId),
            eq(productDrafts.userId, p.userId),
          ),
        )
        .orderBy(desc(productDrafts.updatedAt))
        .limit(50),
    );
  }
  draft(p: Principal, shopId: string, id: string) {
    return this.authorization.withShop(
      p,
      shopId,
      'products.read',
      async (tx) => {
        const [row] = await tx
          .select()
          .from(productDrafts)
          .where(
            and(
              eq(productDrafts.id, id),
              eq(productDrafts.shopId, shopId),
              eq(productDrafts.userId, p.userId),
            ),
          );
        if (!row) throw new NotFoundException();
        return row;
      },
    );
  }
  save(p: Principal, shopId: string, id: string, body: DraftSaveDto) {
    return catalogWrite(() =>
      this.authorization.withShop(p, shopId, 'products.write', async (tx) => {
        const [existing] = await tx
          .select()
          .from(productDrafts)
          .where(eq(productDrafts.id, id))
          .for('update');
        if (
          existing &&
          (existing.shopId !== shopId || existing.userId !== p.userId)
        )
          throw new NotFoundException();
        if ((existing?.version ?? 0) !== body.version || existing?.productId)
          throw new ConflictException();
        const content = JSON.parse(JSON.stringify(body.content)) as Record<
          string,
          unknown
        >;
        const [row] = existing
          ? await tx
              .update(productDrafts)
              .set({
                content,
                version: existing.version + 1,
                updatedAt: new Date(),
              })
              .where(eq(productDrafts.id, id))
              .returning()
          : await tx
              .insert(productDrafts)
              .values({ id, shopId, userId: p.userId, content })
              .returning();
        return row;
      }),
    );
  }
  materialize(p: Principal, shopId: string, id: string) {
    return catalogWrite(() =>
      this.authorization.withShop(p, shopId, 'products.write', async (tx) => {
        const [draft] = await tx
          .select()
          .from(productDrafts)
          .where(
            and(
              eq(productDrafts.id, id),
              eq(productDrafts.shopId, shopId),
              eq(productDrafts.userId, p.userId),
            ),
          )
          .for('update');
        if (!draft) throw new NotFoundException();
        if (draft.productId) {
          const [existing] = await tx
            .select({
              id: products.id,
              slug: products.slug,
              status: products.status,
            })
            .from(products)
            .where(
              and(
                eq(products.id, draft.productId),
                eq(products.shopId, shopId),
              ),
            );
          if (!existing) throw new NotFoundException();
          return existing;
        }
        const body = plainToInstance(ProductCreateDto, {
          ...draft.content,
          slug: 'product-' + randomUUID(),
          status: 'DRAFT',
        });
        if (
          (
            await validate(body, {
              whitelist: true,
              forbidNonWhitelisted: true,
            })
          ).length
        )
          throw new BadRequestException();
        const product = await this.catalog.createInTransaction(
          tx,
          shopId,
          body,
        );
        await tx
          .update(productDrafts)
          .set({ productId: product.id, updatedAt: new Date() })
          .where(eq(productDrafts.id, id));
        return product;
      }),
    );
  }
  duplicate(p: Principal, shopId: string, id: string) {
    return catalogWrite(() =>
      this.authorization.withShop(p, shopId, 'products.write', async (tx) => {
        const [source] = await tx
          .select()
          .from(products)
          .where(and(eq(products.id, id), eq(products.shopId, shopId)));
        if (!source) throw new NotFoundException();
        const variants = await tx
          .select()
          .from(productVariants)
          .where(eq(productVariants.productId, id));
        // SKU is unique within a shop. Images have product-bound keys and cannot be reused.
        const copy = await this.catalog.createInTransaction(tx, shopId, {
          name: (source.name + ' — копия').slice(0, 200),
          slug: 'product-' + randomUUID(),
          categoryId: source.categoryId,
          brandId: source.brandId,
          description: source.description,
          basePrice: source.basePrice,
          oldPrice: source.oldPrice,
          status: 'DRAFT',
          variants: variants.map((v) => ({
            size: v.size,
            color: v.color,
            sku: null,
            priceOverride: v.priceOverride,
            available: v.available,
          })),
        });
        if (source.moderationHidden)
          await tx
            .update(products)
            .set({ moderationHidden: true, moderationPreviousStatus: 'DRAFT' })
            .where(eq(products.id, copy.id));
        return copy;
      }),
    );
  }
  bulk(p: Principal, shopId: string, body: BulkProductDto) {
    return this.authorization.withShop(
      p,
      shopId,
      'products.write',
      async (tx) => {
        const rows = await tx
          .select({
            id: products.id,
            moderationHidden: products.moderationHidden,
          })
          .from(products)
          .where(
            and(inArray(products.id, body.ids), eq(products.shopId, shopId)),
          );
        if (rows.length !== body.ids.length) throw new NotFoundException();
        if (body.action === 'PUBLISH') {
          if (rows.some((row) => row.moderationHidden))
            throw new ConflictException('Товар скрыт модератором.');
          const images = await tx
            .select({ id: productImages.productId })
            .from(productImages)
            .where(inArray(productImages.productId, body.ids));
          if (body.ids.some((id) => !images.some((img) => img.id === id)))
            throw new BadRequestException(
              'Добавьте фотографию каждому товару.',
            );
        }
        if (body.action === 'AVAILABILITY')
          await tx
            .update(productVariants)
            .set({ available: body.available, updatedAt: new Date() })
            .where(
              and(
                inArray(productVariants.productId, body.ids),
                eq(productVariants.shopId, shopId),
              ),
            );
        else
          await tx
            .update(products)
            .set({
              status:
                body.action === 'PUBLISH'
                  ? 'PUBLISHED'
                  : body.action === 'ARCHIVE'
                    ? 'ARCHIVED'
                    : 'DRAFT',
              updatedAt: new Date(),
            })
            .where(
              and(inArray(products.id, body.ids), eq(products.shopId, shopId)),
            );
        return { changed: rows.length };
      },
    );
  }
  reorder(p: Principal, shopId: string, id: string, body: ImageOrderDto) {
    return this.authorization.withShop(
      p,
      shopId,
      'products.write',
      async (tx) => {
        const [owned] = await tx
          .select({ id: products.id })
          .from(products)
          .where(and(eq(products.id, id), eq(products.shopId, shopId)));
        if (!owned) throw new NotFoundException();
        const images = await tx
          .select()
          .from(productImages)
          .where(eq(productImages.productId, id));
        if (
          images.length !== body.ids.length ||
          body.ids.some((imageId) => !images.some((img) => img.id === imageId))
        )
          throw new BadRequestException();
        // Delete/reinsert metadata atomically to satisfy the immediate unique position constraint.
        // Storage objects and image IDs are preserved; no binary data is copied.
        await tx.delete(productImages).where(eq(productImages.productId, id));
        await tx.insert(productImages).values(
          body.ids.map((imageId, position) => ({
            ...images.find((img) => img.id === imageId)!,
            position,
            updatedAt: new Date(),
          })),
        );
        await tx
          .update(products)
          .set({ updatedAt: sql`now()` })
          .where(eq(products.id, id));
        return { reordered: images.length };
      },
    );
  }
}
