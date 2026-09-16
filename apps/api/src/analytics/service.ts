import {
  BadRequestException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { sql } from 'drizzle-orm';
import { Database } from '../database.js';
import { ShopAuthorization } from '../authorization/shop-authorization.js';
import type { Principal } from '../auth/metadata.js';
import { analyticsEvents } from '../db/schema.js';
import { subscriptionVisible } from '../subscriptions/visibility.js';
import type { AnalyticsEventDto } from './dto.js';

@Injectable()
export class AnalyticsService {
  constructor(
    @Inject(Database) private readonly db: Database,
    @Inject(ShopAuthorization)
    private readonly authorization: ShopAuthorization,
  ) {}
  async record(event: AnalyticsEventDto) {
    if (
      (event.type === 'SHOP_VIEW' && event.resource !== 'shop') ||
      (event.type === 'PRODUCT_VIEW' && event.resource !== 'product')
    )
      throw new BadRequestException();
    await this.db.client.transaction(async (tx) => {
      const result = await tx.execute<{
        shopId: string;
        productId: string | null;
        whatsapp: string | null;
        map: string | null;
      }>(sql`
        SELECT s.id AS "shopId", ${event.resource === 'product' ? sql`p.id` : sql`NULL::uuid`} AS "productId",
          c.whatsapp_phone AS whatsapp, l.two_gis_url AS map
        FROM shops s
        ${event.resource === 'product' ? sql`JOIN products p ON p.shop_id=s.id AND p.slug=${event.slug} AND p.status='PUBLISHED'` : sql``}
        LEFT JOIN shop_contacts c ON c.shop_id=s.id LEFT JOIN shop_locations l ON l.shop_id=s.id
        WHERE s.status='ACTIVE' AND ${subscriptionVisible(sql`s.id`)}
        ${event.resource === 'shop' ? sql`AND s.slug=${event.slug}` : sql``}
        FOR SHARE OF s`);
      const target = result.rows[0];
      if (
        !target ||
        (event.type === 'WHATSAPP_CLICK' && !target.whatsapp) ||
        (event.type === 'TWO_GIS_CLICK' && !target.map)
      )
        throw new NotFoundException();
      await tx
        .insert(analyticsEvents)
        .values({
          eventId: event.eventId,
          type: event.type,
          shopId: target.shopId,
          productId: target.productId,
        })
        .onConflictDoNothing();
    });
    return { accepted: true };
  }
  summary(principal: Principal, shopId: string, days: number) {
    if (![7, 30, 90].includes(days)) throw new BadRequestException();
    return this.authorization.withShop(
      principal,
      shopId,
      'analytics.read',
      async (tx, shop) => {
        // One clock boundary and two bounded aggregate queries; never one query per product.
        const to = new Date();
        const from = new Date(to.getTime() - days * 86400000);
        const totals = await tx.execute<{ type: string; count: number }>(sql`
        SELECT type, count(*)::int AS count FROM analytics_events
        WHERE shop_id=${shop.id} AND created_at>=${from} AND created_at<${to} GROUP BY type`);
        const popular = await tx.execute<{
          id: string;
          name: string;
          slug: string;
          views: number;
        }>(sql`
        SELECT p.id,p.name,p.slug,count(*)::int AS views FROM analytics_events e
        JOIN products p ON p.id=e.product_id AND p.shop_id=e.shop_id
        WHERE e.shop_id=${shop.id} AND e.type='PRODUCT_VIEW' AND e.created_at>=${from} AND e.created_at<${to}
        GROUP BY p.id ORDER BY views DESC,p.id LIMIT 10`);
        return {
          days,
          from: from.toISOString(),
          to: to.toISOString(),
          totals: Object.fromEntries(
            [
              'SHOP_VIEW',
              'PRODUCT_VIEW',
              'WHATSAPP_CLICK',
              'TWO_GIS_CLICK',
              'CUSTOMER_REQUEST_CREATED',
            ].map((type) => [
              type,
              totals.rows.find((row) => row.type === type)?.count ?? 0,
            ]),
          ),
          popularProducts: popular.rows,
        };
      },
    );
  }
}
