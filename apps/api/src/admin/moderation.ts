import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { and, desc, eq, isNull, or, sql } from 'drizzle-orm';
import {
  shops,
  shopContacts,
  shopLocations,
  shopMembers,
  moderationCases,
  moderationHistory,
  auditLogs,
} from '../db/schema.js';
import { ShopAuthorization } from '../authorization/shop-authorization.js';
import type { Principal } from '../auth/metadata.js';
import { AdminAuth, adminPermissions } from './auth.js';
import { appendAudit, AuditLog } from './audit.js';
import type { AdminPrincipal } from './metadata.js';
import type { AdminQueryDto, ModerationDecisionDto } from './dto.js';
import { syncModeratedShop } from '../subscriptions/visibility.js';
import { subscriptionVisible } from '../subscriptions/visibility.js';

export function requireEditableShopIdentity(status: string) {
  if (['PENDING_VERIFICATION', 'VERIFIED', 'ACTIVE'].includes(status))
    throw new ConflictException();
}
@Injectable()
export class ModerationService {
  constructor(
    @Inject(ShopAuthorization) private readonly seller: ShopAuthorization,
    @Inject(AdminAuth) private readonly admin: AdminAuth,
    @Inject(AuditLog) private readonly audit: AuditLog,
  ) {}
  submit(p: Principal, shopId: string) {
    return this.seller.withShop(
      p,
      shopId,
      'shop.settings.write',
      async (tx, shop) => {
        if (!['DRAFT', 'CHANGES_REQUESTED', 'REJECTED'].includes(shop.status))
          throw new ConflictException();
        const [location] = await tx
          .select()
          .from(shopLocations)
          .where(eq(shopLocations.shopId, shop.id));
        const [contacts] = await tx
          .select()
          .from(shopContacts)
          .where(eq(shopContacts.shopId, shop.id));
        if (
          !location?.address ||
          (!contacts?.phone && !contacts?.whatsappPhone)
        )
          throw new BadRequestException();
        const [entry] = await tx
          .insert(moderationCases)
          .values({ shopId: shop.id, submittedBy: p.userId })
          .returning();
        if (!entry) throw new Error('Moderation case insert failed');
        await tx
          .update(shops)
          .set({ status: 'PENDING_VERIFICATION' })
          .where(eq(shops.id, shop.id));
        await tx.insert(moderationHistory).values({
          shopId: shop.id,
          caseId: entry.id,
          actorId: p.userId,
          action: 'SUBMIT',
          fromStatus: shop.status,
          toStatus: 'PENDING_VERIFICATION',
        });
        await appendAudit(tx, {
          actor: 'USER:' + p.userId,
          action: 'MODERATION_SUBMIT',
          resource: 'shop',
          resourceId: shop.id,
          result: 'SUCCESS',
        });
        return { status: 'PENDING_VERIFICATION', caseId: entry.id };
      },
    );
  }
  sellerHistory(p: Principal, shopId: string) {
    return this.seller.withShop(p, shopId, 'shop.read', (tx) =>
      tx
        .select({
          id: moderationHistory.id,
          action: moderationHistory.action,
          status: moderationHistory.toStatus,
          reason: moderationHistory.reason,
          createdAt: moderationHistory.createdAt,
        })
        .from(moderationHistory)
        .where(eq(moderationHistory.shopId, shopId))
        .orderBy(desc(moderationHistory.createdAt), desc(moderationHistory.id))
        .limit(50),
    );
  }
  dashboard(p: AdminPrincipal) {
    return this.admin.withPermission(p, 'moderation.read', (tx) =>
      tx
        .select({ status: shops.status, count: sql<number>`count(*)::integer` })
        .from(shops)
        .groupBy(shops.status),
    );
  }
  list(p: AdminPrincipal, q: AdminQueryDto) {
    return this.admin.withPermission(p, 'moderation.read', async (tx) => {
      const pattern = '%' + q.q.trim().replace(/[\\%_]/g, '\\$&') + '%';
      const where = and(
        q.status ? eq(shops.status, q.status) : undefined,
        q.q
          ? sql`(${shops.name} ILIKE ${pattern} OR EXISTS (SELECT 1 FROM shop_members m JOIN users u ON u.id=m.user_id WHERE m.shop_id=${shops.id} AND m.role='SHOP_OWNER' AND u.email ILIKE ${pattern}))`
          : undefined,
      );
      const [count] = await tx
        .select({ total: sql<number>`count(*)::integer` })
        .from(shops)
        .where(where);
      const items = await tx
        .select({
          id: shops.id,
          name: shops.name,
          status: shops.status,
          createdAt: shops.createdAt,
          ownerEmail: sql<
            string | null
          >`(SELECT u.email FROM shop_members m JOIN users u ON u.id=m.user_id WHERE m.shop_id=${shops.id} AND m.role='SHOP_OWNER' ORDER BY m.created_at LIMIT 1)`,
          productCount: sql<number>`(SELECT count(*)::integer FROM products p WHERE p.shop_id=${shops.id})`,
          subscriptionStatus: sql<
            string | null
          >`(SELECT status FROM subscriptions WHERE shop_id=${shops.id})`,
          publicVisible: sql<boolean>`${shops.status}='ACTIVE' AND ${subscriptionVisible(shops.id)}`,
        })
        .from(shops)
        .where(where)
        .orderBy(desc(shops.createdAt), desc(shops.id))
        .limit(20)
        .offset((q.page - 1) * 20);
      return { items, total: count?.total ?? 0, page: q.page };
    });
  }
  detail(p: AdminPrincipal, shopId: string) {
    return this.admin.withPermission(
      p,
      'moderation.read',
      async (tx, account) => {
        const [shop] = await tx
          .select()
          .from(shops)
          .where(eq(shops.id, shopId))
          .for('share');
        if (!shop) throw new NotFoundException();
        const [location] = await tx
          .select()
          .from(shopLocations)
          .where(eq(shopLocations.shopId, shop.id));
        const [contacts] = await tx
          .select()
          .from(shopContacts)
          .where(eq(shopContacts.shopId, shop.id));
        const [currentCase] = await tx
          .select()
          .from(moderationCases)
          .where(eq(moderationCases.shopId, shop.id))
          .orderBy(desc(moderationCases.createdAt), desc(moderationCases.id))
          .limit(1);
        const history = await tx
          .select()
          .from(moderationHistory)
          .where(eq(moderationHistory.shopId, shop.id))
          .orderBy(
            desc(moderationHistory.createdAt),
            desc(moderationHistory.id),
          )
          .limit(50);
        const members = (
          await tx.execute(
            sql`SELECT m.id,m.user_id AS "userId",u.email,m.role FROM shop_members m JOIN users u ON u.id=m.user_id WHERE m.shop_id=${shop.id} ORDER BY m.created_at LIMIT 100`,
          )
        ).rows;
        const subscription =
          (
            await tx.execute(
              sql`SELECT plan,status,period_start AS "periodStart",period_end AS "periodEnd",next_payment_at AS "nextPaymentAt" FROM subscriptions WHERE shop_id=${shop.id}`,
            )
          ).rows[0] ?? null;
        const productList = (
          await tx.execute(
            sql`SELECT id,name,status FROM products WHERE shop_id=${shop.id} ORDER BY updated_at DESC LIMIT 20`,
          )
        ).rows;
        const audit = adminPermissions(account).includes('audit.read')
          ? await tx
              .select()
              .from(auditLogs)
              .where(eq(auditLogs.resourceId, shop.id))
              .orderBy(desc(auditLogs.createdAt), desc(auditLogs.id))
              .limit(20)
          : [];
        return {
          members,
          subscription,
          products: productList,
          audit,
          shop,
          location: location ?? null,
          contacts: contacts ?? null,
          currentCase: currentCase ?? null,
          history,
        };
      },
    );
  }
  async decide(
    p: AdminPrincipal,
    shopId: string,
    body: ModerationDecisionDto,
    requestId?: string,
  ) {
    try {
      return await this.admin.withPermission(
        p,
        ['SUSPEND', 'RESTORE'].includes(body.action)
          ? 'moderation.suspend'
          : 'moderation.write',
        async (tx) => {
          const [shop] = await tx
            .select()
            .from(shops)
            .where(eq(shops.id, shopId))
            .for('update');
          if (!shop) throw new NotFoundException();
          if (
            (
              await tx
                .select({ id: shopMembers.id })
                .from(shopMembers)
                .where(
                  and(
                    eq(shopMembers.shopId, shop.id),
                    eq(shopMembers.userId, p.userId),
                  ),
                )
            )[0]
          )
            throw new ForbiddenException();
          if (shop.status !== body.expectedStatus)
            throw new ConflictException();
          const [entry] = await tx
            .select()
            .from(moderationCases)
            .where(eq(moderationCases.shopId, shop.id))
            .orderBy(desc(moderationCases.createdAt), desc(moderationCases.id))
            .limit(1);
          if ((body.caseId ?? null) !== (entry?.id ?? null))
            throw new NotFoundException();
          const reason = body.reason ?? '';
          if (body.action !== 'APPROVE' && !reason.trim())
            throw new BadRequestException();
          const transitions: Record<
            ModerationDecisionDto['action'],
            readonly string[]
          > = {
            APPROVE: ['PENDING_VERIFICATION'],
            REJECT: ['PENDING_VERIFICATION'],
            REQUEST_CHANGES: [
              'PENDING_VERIFICATION',
              'VERIFIED',
              'ACTIVE',
              'SUSPENDED',
            ],
            SUSPEND: ['PENDING_VERIFICATION', 'VERIFIED', 'ACTIVE'],
            RESTORE: ['SUSPENDED'],
          };
          if (!transitions[body.action].includes(shop.status))
            throw new ConflictException();
          if (body.action === 'RESTORE') {
            const [suspension] = await tx
              .select()
              .from(moderationHistory)
              .where(
                and(
                  eq(moderationHistory.shopId, shop.id),
                  eq(moderationHistory.action, 'SUSPEND'),
                ),
              )
              .orderBy(
                desc(moderationHistory.createdAt),
                desc(moderationHistory.id),
              )
              .limit(1);
            if (
              !suspension ||
              !['VERIFIED', 'ACTIVE'].includes(suspension.fromStatus)
            )
              throw new ConflictException();
          }
          if (
            shop.status === 'PENDING_VERIFICATION' &&
            (!entry || entry.closedAt)
          )
            throw new ConflictException();
          const status = {
            APPROVE: 'VERIFIED',
            REQUEST_CHANGES: 'CHANGES_REQUESTED',
            REJECT: 'REJECTED',
            SUSPEND: 'SUSPENDED',
            RESTORE: 'VERIFIED',
          } as const;
          let toStatus: typeof shops.$inferSelect.status = status[body.action];
          if (body.action === 'APPROVE' || body.action === 'RESTORE')
            toStatus = await syncModeratedShop(tx, {
              ...shop,
              status: 'VERIFIED',
            });
          await tx
            .update(shops)
            .set({ status: toStatus })
            .where(eq(shops.id, shop.id));
          if (entry && !entry.closedAt)
            await tx
              .update(moderationCases)
              .set({ closedAt: sql`now()` })
              .where(
                and(
                  eq(moderationCases.id, entry.id),
                  isNull(moderationCases.closedAt),
                ),
              );
          await tx.insert(moderationHistory).values({
            shopId: shop.id,
            caseId: entry?.id ?? null,
            actorId: p.userId,
            action: body.action,
            fromStatus: shop.status,
            toStatus,
            reason,
          });
          await appendAudit(tx, {
            actor: 'USER:' + p.userId,
            action: body.action,
            resource: 'shop',
            resourceId: shop.id,
            result: 'SUCCESS',
            reason,
            ...(requestId ? { requestId } : {}),
          });
          return { id: shop.id, status: toStatus };
        },
      );
    } catch (e) {
      await this.audit.append({
        actor: 'USER:' + p.userId,
        action: body.action,
        resource: 'shop',
        resourceId: shopId,
        result: 'FAILED',
      });
      throw e;
    }
  }
  auditTrail(p: AdminPrincipal, q: AdminQueryDto) {
    return this.admin.withPermission(p, 'audit.read', (tx) =>
      tx
        .select()
        .from(auditLogs)
        .where(
          q.resourceId
            ? or(
                eq(auditLogs.resourceId, q.resourceId),
                eq(auditLogs.actor, 'USER:' + q.resourceId),
              )
            : undefined,
        )
        .orderBy(desc(auditLogs.createdAt), desc(auditLogs.id))
        .limit(20)
        .offset((q.page - 1) * 20),
    );
  }
}
