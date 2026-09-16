import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { and, eq, sql, desc, asc, ilike } from 'drizzle-orm';
import { ShopAuthorization } from '../authorization/shop-authorization.js';
import type { Principal } from '../auth/metadata.js';
import type { Transaction } from '../database.js';
import {
  categories,
  brands,
  products,
  productVariants,
  productImages,
  shopLocations,
  shopContacts,
} from '../db/schema.js';
import { normalizePhone, normalizeTwoGis } from './two-gis.js';
import { requireEditableShopIdentity } from '../admin/moderation.js';
import type {
  ProductCreateDto,
  ProductFieldsDto,
  VariantDto,
  LocationDto,
  ContactsDto,
  CatalogQueryDto,
} from './dto.js';
import type { ProductListQueryDto } from './operations.dto.js';
function values(body: ProductFieldsDto) {
  return {
    name: body.name,
    slug: body.slug,
    description: body.description,
    categoryId: body.categoryId,
    brandId: body.brandId ?? null,
    basePrice: body.basePrice,
    oldPrice: body.oldPrice ?? null,
    status: body.status,
  };
}
function variantValues(body: VariantDto) {
  return {
    size: body.size ?? null,
    color: body.color ?? null,
    sku: body.sku ?? null,
    priceOverride: body.priceOverride ?? null,
    available: body.available,
  };
}
export async function catalogWrite<T>(operation: () => Promise<T>): Promise<T> {
  try {
    return await operation();
  } catch (error) {
    const cause =
      error instanceof Error && 'cause' in error ? error.cause : error;
    if (cause && typeof cause === 'object' && 'code' in cause) {
      if (cause.code === '23505') throw new ConflictException();
      if (cause.code === '23503' || cause.code === '23514')
        throw new BadRequestException();
    }
    throw error;
  }
}
@Injectable()
export class SellerCatalogService {
  constructor(
    @Inject(ShopAuthorization)
    private readonly authorization: ShopAuthorization,
  ) {}
  private async references(tx: Transaction, body: ProductFieldsDto) {
    if (body.oldPrice != null && body.oldPrice <= body.basePrice)
      throw new BadRequestException();
    // Hold reference names stable until the search document has been committed.
    const [category] = await tx
      .select({ id: categories.id, parentId: categories.parentId })
      .from(categories)
      .where(eq(categories.id, body.categoryId))
      .for('share');
    if (!category) throw new BadRequestException();
    if (category.parentId)
      await tx
        .select({ id: categories.id })
        .from(categories)
        .where(eq(categories.id, category.parentId))
        .for('share');
    if (
      body.brandId &&
      !(
        await tx
          .select({ id: brands.id })
          .from(brands)
          .where(eq(brands.id, body.brandId))
          .for('share')
      )[0]
    )
      throw new BadRequestException();
  }
  private async product(tx: Transaction, shopId: string, id: string) {
    const [row] = await tx
      .select()
      .from(products)
      .where(and(eq(products.id, id), eq(products.shopId, shopId)));
    if (!row) throw new NotFoundException();
    return row;
  }
  async createInTransaction(
    tx: Transaction,
    shopId: string,
    body: ProductCreateDto,
  ) {
    await this.references(tx, body);
    const [row] = await tx
      .insert(products)
      .values({ ...values(body), shopId })
      .returning();
    if (!row) throw new Error('Product insert failed');
    await tx.insert(productVariants).values(
      body.variants.map((v) => ({
        ...variantValues(v),
        productId: row.id,
        shopId,
      })),
    );
    return { id: row.id, slug: row.slug, status: row.status };
  }
  create(principal: Principal, shopId: string, body: ProductCreateDto) {
    return catalogWrite(() =>
      this.authorization.withShop(
        principal,
        shopId,
        'products.write',
        async (tx, shop) => {
          return this.createInTransaction(tx, shop.id, body);
        },
      ),
    );
  }
  update(
    principal: Principal,
    shopId: string,
    id: string,
    body: ProductFieldsDto,
  ) {
    return catalogWrite(() =>
      this.authorization.withShop(
        principal,
        shopId,
        'products.write',
        async (tx, shop) => {
          const current = await this.product(tx, shop.id, id);
          if (current.moderationHidden && body.status === 'PUBLISHED')
            throw new ConflictException('Товар скрыт модератором.');
          await this.references(tx, body);
          const [row] = await tx
            .update(products)
            .set({ ...values(body), updatedAt: new Date() })
            .where(and(eq(products.id, id), eq(products.shopId, shop.id)))
            .returning({
              id: products.id,
              slug: products.slug,
              status: products.status,
            });
          return row;
        },
      ),
    );
  }
  list(
    principal: Principal,
    shopId: string,
    query: ProductListQueryDto | CatalogQueryDto,
  ) {
    return this.authorization.withShop(
      principal,
      shopId,
      'products.read',
      (tx, shop) =>
        tx
          .select({
            id: products.id,
            name: products.name,
            slug: products.slug,
            status: products.status,
            basePrice: products.basePrice,
            categoryId: products.categoryId,
            categoryName: categories.name,
            updatedAt: products.updatedAt,
            imageId: sql<
              string | null
            >`(SELECT id FROM product_images WHERE product_id = ${products.id} ORDER BY position LIMIT 1)`,
            available: sql<boolean>`EXISTS (SELECT 1 FROM product_variants WHERE product_id = ${products.id} AND availability)`,
            views: sql<number>`(SELECT count(*)::integer FROM analytics_events WHERE product_id = ${products.id} AND type = 'PRODUCT_VIEW' AND created_at >= now() - interval '30 days')`,
            total: sql<number>`count(*) OVER()::integer`,
          })
          .from(products)
          .innerJoin(categories, eq(categories.id, products.categoryId))
          .where(
            and(
              eq(products.shopId, shop.id),
              query.q
                ? ilike(
                    products.name,
                    '%' + query.q.replace(/[\\%_]/g, '\\$&') + '%',
                  )
                : undefined,
              query.category ? eq(categories.slug, query.category) : undefined,
              'status' in query && query.status
                ? eq(
                    products.status,
                    query.status as 'DRAFT' | 'PUBLISHED' | 'ARCHIVED',
                  )
                : undefined,
              query.availability === 'available'
                ? sql`EXISTS (SELECT 1 FROM product_variants WHERE product_id = ${products.id} AND availability)`
                : undefined,
              'stock' in query && query.stock
                ? sql`EXISTS (SELECT 1 FROM product_variants WHERE product_id = ${products.id} AND availability) = ${query.stock === 'available'}`
                : undefined,
            ),
          )
          .orderBy(
            query.sort === 'price-asc'
              ? asc(products.basePrice)
              : query.sort === 'price-desc'
                ? desc(products.basePrice)
                : desc(products.updatedAt),
            products.id,
          )
          .limit(query.limit)
          .offset((query.page - 1) * query.limit),
    );
  }
  get(principal: Principal, shopId: string, id: string) {
    return this.authorization.withShop(
      principal,
      shopId,
      'products.read',
      async (tx, shop) => {
        const row = await this.product(tx, shop.id, id);
        const variants = await tx
          .select()
          .from(productVariants)
          .where(eq(productVariants.productId, id));
        const images = await tx
          .select()
          .from(productImages)
          .where(eq(productImages.productId, id));
        const { searchText: _text, searchVector: _vector, ...product } = row;
        void _text;
        void _vector;
        return { ...product, variants, images };
      },
    );
  }
  addVariant(
    principal: Principal,
    shopId: string,
    id: string,
    body: VariantDto,
  ) {
    return catalogWrite(() =>
      this.authorization.withShop(
        principal,
        shopId,
        'products.write',
        async (tx, shop) => {
          await this.product(tx, shop.id, id);
          const rows = await tx
            .select({ id: productVariants.id })
            .from(productVariants)
            .where(eq(productVariants.productId, id));
          if (rows.length >= 100) throw new BadRequestException();
          const [variant] = await tx
            .insert(productVariants)
            .values({ ...variantValues(body), productId: id, shopId: shop.id })
            .returning();
          return variant;
        },
      ),
    );
  }
  updateVariant(
    principal: Principal,
    shopId: string,
    id: string,
    variantId: string,
    body: VariantDto,
  ) {
    return catalogWrite(() =>
      this.authorization.withShop(
        principal,
        shopId,
        'products.write',
        async (tx, shop) => {
          await this.product(tx, shop.id, id);
          const [variant] = await tx
            .update(productVariants)
            .set(variantValues(body))
            .where(
              and(
                eq(productVariants.id, variantId),
                eq(productVariants.productId, id),
                eq(productVariants.shopId, shop.id),
              ),
            )
            .returning();
          if (!variant) throw new NotFoundException();
          return variant;
        },
      ),
    );
  }
  location(principal: Principal, shopId: string, body: LocationDto) {
    return catalogWrite(() =>
      this.authorization.withShop(
        principal,
        shopId,
        'shop.settings.write',
        async (tx, shop) => {
          const link = normalizeTwoGis(body.twoGisUrl, body.twoGisFirmId);
          requireEditableShopIdentity(shop.status);
          if ((body.latitude == null) !== (body.longitude == null))
            throw new BadRequestException();
          const data = {
            address: body.address,
            mall: body.mall ?? null,
            ...link,
            latitude: body.latitude ?? null,
            longitude: body.longitude ?? null,
          };
          const [row] = await tx
            .insert(shopLocations)
            .values({ ...data, shopId: shop.id })
            .onConflictDoUpdate({ target: shopLocations.shopId, set: data })
            .returning();
          return row;
        },
      ),
    );
  }
  profile(principal: Principal, shopId: string) {
    return this.authorization.withShop(
      principal,
      shopId,
      'shop.read',
      async (tx, shop) => {
        const [location] = await tx
          .select()
          .from(shopLocations)
          .where(eq(shopLocations.shopId, shop.id));
        const [contacts] = await tx
          .select()
          .from(shopContacts)
          .where(eq(shopContacts.shopId, shop.id));
        return { location: location ?? null, contacts: contacts ?? null };
      },
    );
  }
  contacts(principal: Principal, shopId: string, body: ContactsDto) {
    return catalogWrite(() =>
      this.authorization.withShop(
        principal,
        shopId,
        'shop.settings.write',
        async (tx, shop) => {
          const data = {
            phone: normalizePhone(body.phone),
            whatsappPhone: normalizePhone(body.whatsappPhone),
          };
          requireEditableShopIdentity(shop.status);
          const [row] = await tx
            .insert(shopContacts)
            .values({ ...data, shopId: shop.id })
            .onConflictDoUpdate({ target: shopContacts.shopId, set: data })
            .returning();
          return row;
        },
      ),
    );
  }
}
