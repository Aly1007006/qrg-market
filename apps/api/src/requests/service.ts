import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { APP_CONFIG, type AppConfig } from '../config.js';
import { and, desc, eq, gte, sql } from 'drizzle-orm';
import { Database, type Transaction } from '../database.js';
import { subscriptionVisible } from '../subscriptions/visibility.js';
import {
  customerRequests,
  products,
  productVariants,
  shops,
} from '../db/schema.js';
import { ShopAuthorization } from '../authorization/shop-authorization.js';
import type { Principal } from '../auth/metadata.js';
import { AuthRateLimiter } from '../auth/rate-limiter.js';
import { normalizePhone } from '../catalogue/two-gis.js';
import { CaptchaVerifier, RequestFingerprint } from './spam.js';
import {
  PRIVACY_VERSION,
  type CreateRequestDto,
  type RequestQueryDto,
  type RequestStatusDto,
} from './dto.js';
async function publicProduct(tx: Transaction, id: string) {
  const [reference] = await tx
    .select({ shopId: products.shopId })
    .from(products)
    .where(eq(products.id, id));
  if (!reference) throw new NotFoundException();
  const [shop] = await tx
    .select({ id: shops.id })
    .from(shops)
    .where(
      and(
        eq(shops.id, reference.shopId),
        eq(shops.status, 'ACTIVE'),
        subscriptionVisible(shops.id),
      ),
    )
    .for('share');
  if (!shop) throw new NotFoundException();
  const [product] = await tx
    .select()
    .from(products)
    .where(
      and(
        eq(products.id, id),
        eq(products.shopId, shop.id),
        eq(products.status, 'PUBLISHED'),
      ),
    )
    .for('share');
  if (!product) throw new NotFoundException();
  return product;
}
const fields = {
  id: customerRequests.id,
  productId: customerRequests.productId,
  variantId: customerRequests.variantId,
  productName: customerRequests.productName,
  variantLabel: customerRequests.variantLabel,
  name: customerRequests.name,
  phone: customerRequests.phone,
  quantity: customerRequests.quantity,
  pickupPreference: customerRequests.pickupPreference,
  comment: customerRequests.comment,
  status: customerRequests.status,
  createdAt: customerRequests.createdAt,
  updatedAt: customerRequests.updatedAt,
};
@Injectable()
export class CustomerRequestsService {
  private readonly enabled: boolean;
  constructor(
    @Inject(Database) private readonly db: Database,
    @Inject(ShopAuthorization)
    private readonly authorization: ShopAuthorization,
    @Inject(AuthRateLimiter) private readonly limiter: AuthRateLimiter,
    @Inject(RequestFingerprint)
    private readonly fingerprint: RequestFingerprint,
    @Inject(CaptchaVerifier) private readonly captcha: CaptchaVerifier,
    @Inject(APP_CONFIG) config: AppConfig,
  ) {
    const enabled =
      process.env.CUSTOMER_REQUESTS_ENABLED ??
      (config.environment === 'production' ? 'false' : 'true');
    if (!['true', 'false'].includes(enabled))
      throw new Error('Invalid CUSTOMER_REQUESTS_ENABLED');
    this.enabled = enabled === 'true';
  }
  async challenge(productId: string) {
    if (!this.enabled) throw new ServiceUnavailableException();
    await this.db.client.transaction((tx) => publicProduct(tx, productId));
    return {
      challenge: this.fingerprint.issue(productId),
      policyVersion: PRIVACY_VERSION,
      minimumDelayMs: 2000,
    };
  }
  async create(body: CreateRequestDto) {
    if (!this.enabled) throw new ServiceUnavailableException();
    if (body.privacyConsent !== true || body.policyVersion !== PRIVACY_VERSION)
      throw new BadRequestException();
    if (body.website) throw new BadRequestException();
    this.fingerprint.verify(body.challenge, body.productId);
    const phone = normalizePhone(body.phone);
    if (!phone) throw new BadRequestException();
    await this.limiter.consume(`lead:phone:${phone}`, 5);
    await this.captcha.verify({
      ...(body.captchaToken ? { token: body.captchaToken } : {}),
      productId: body.productId,
      action: 'customer-request',
    });
    const data = {
      name: body.name,
      phone,
      productId: body.productId,
      variantId: body.variantId ?? null,
      quantity: body.quantity,
      pickupPreference: body.pickupPreference ?? null,
      comment: body.comment || null,
      consentVersion: PRIVACY_VERSION,
    };
    const dedupHash = this.fingerprint.hash(JSON.stringify(data));
    const submissionHash = this.fingerprint.hash(body.challenge);
    await this.db.client.transaction(async (tx) => {
      // Lock the submission token first, then dedup fingerprint. Both are opaque hashes.
      await tx.execute(
        sql`SELECT pg_advisory_xact_lock(hashtextextended(${submissionHash}, 71624705))`,
      );
      await tx.execute(
        sql`SELECT pg_advisory_xact_lock(hashtextextended(${dedupHash}, 71624706))`,
      );
      const [replay] = await tx
        .select({ hash: customerRequests.dedupHash })
        .from(customerRequests)
        .where(eq(customerRequests.submissionHash, submissionHash));
      if (replay) {
        if (replay.hash !== dedupHash) throw new ConflictException();
        return;
      }
      const product = await publicProduct(tx, body.productId);
      let variantLabel = '';
      if (body.variantId) {
        const [variant] = await tx
          .select()
          .from(productVariants)
          .where(
            and(
              eq(productVariants.id, body.variantId),
              eq(productVariants.productId, product.id),
              eq(productVariants.shopId, product.shopId),
            ),
          )
          .for('share');
        if (!variant) throw new BadRequestException();
        variantLabel =
          [variant.size, variant.color].filter(Boolean).join(' · ') ||
          'Стандартный вариант';
      }
      const [duplicate] = await tx
        .select({ id: customerRequests.id })
        .from(customerRequests)
        .where(
          and(
            eq(customerRequests.dedupHash, dedupHash),
            gte(customerRequests.createdAt, new Date(Date.now() - 900000)),
          ),
        );
      if (duplicate) return;
      await tx.insert(customerRequests).values({
        ...data,
        shopId: product.shopId,
        productName: product.name,
        variantLabel,
        submissionHash,
        dedupHash,
      });
    });
    return { accepted: true };
  }
  list(p: Principal, shopId: string, q: RequestQueryDto) {
    return this.authorization.withShop(
      p,
      shopId,
      'requests.read',
      async (tx, shop) => {
        const where = and(
          eq(customerRequests.shopId, shop.id),
          q.status ? eq(customerRequests.status, q.status) : undefined,
        );
        const [count] = await tx
          .select({ total: sql<number>`count(*)::integer` })
          .from(customerRequests)
          .where(where);
        const items = await tx
          .select({
            id: customerRequests.id,
            productName: customerRequests.productName,
            variantLabel: customerRequests.variantLabel,
            name: customerRequests.name,
            quantity: customerRequests.quantity,
            status: customerRequests.status,
            createdAt: customerRequests.createdAt,
          })
          .from(customerRequests)
          .where(where)
          .orderBy(desc(customerRequests.createdAt), desc(customerRequests.id))
          .limit(q.limit)
          .offset((q.page - 1) * q.limit);
        return { items, total: count?.total ?? 0, page: q.page };
      },
    );
  }
  get(p: Principal, shopId: string, id: string) {
    return this.authorization.withShop(
      p,
      shopId,
      'requests.read',
      async (tx, shop) => {
        const [row] = await tx
          .select(fields)
          .from(customerRequests)
          .where(
            and(
              eq(customerRequests.id, id),
              eq(customerRequests.shopId, shop.id),
            ),
          );
        if (!row) throw new NotFoundException();
        return row;
      },
    );
  }
  update(p: Principal, shopId: string, id: string, body: RequestStatusDto) {
    return this.authorization.withShop(
      p,
      shopId,
      'requests.write',
      async (tx, shop) => {
        const [row] = await tx
          .select({ status: customerRequests.status })
          .from(customerRequests)
          .where(
            and(
              eq(customerRequests.id, id),
              eq(customerRequests.shopId, shop.id),
            ),
          );
        if (!row) throw new NotFoundException();
        if (row.status !== body.expectedStatus) throw new ConflictException();
        if (body.status === 'NEW' && row.status !== 'NEW')
          throw new BadRequestException();
        // Status is a communication workflow only. No payment or stock changes.
        const [updated] = await tx
          .update(customerRequests)
          .set({
            status: body.status,
            statusChangedBy: p.userId,
            updatedAt: new Date(),
          })
          .where(
            and(
              eq(customerRequests.id, id),
              eq(customerRequests.shopId, shop.id),
              eq(customerRequests.status, body.expectedStatus),
            ),
          )
          .returning({
            id: customerRequests.id,
            status: customerRequests.status,
          });
        if (!updated) throw new ConflictException();
        return updated;
      },
    );
  }
}
