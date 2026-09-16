import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { and, eq, isNull, ne, sql } from 'drizzle-orm';
import type { Transaction } from '../database.js';
import {
  adminAccounts,
  adminSessions,
  products,
  shopMembers,
  shops,
  users,
} from '../db/schema.js';
import { Passwords } from '../auth/passwords.js';
import { revokeUserSessions } from '../auth/service.js';
import { AdminAuth } from './auth.js';
import { appendAudit } from './audit.js';
import type { AdminPrincipal } from './metadata.js';
import type {
  AdminActionDto,
  AdminCreateDto,
  ControlQueryDto,
  ProductModerationDto,
  UserActionDto,
} from './control.dto.js';

export async function protectLastSuperAdmin(tx: Transaction, userId: string) {
  const [target] = await tx
    .select()
    .from(adminAccounts)
    .where(eq(adminAccounts.userId, userId));
  if (target?.role !== 'SUPER_ADMIN' || !target.enabled) return;
  const [other] = await tx
    .select({ id: users.id })
    .from(adminAccounts)
    .innerJoin(users, eq(users.id, adminAccounts.userId))
    .where(
      and(
        eq(adminAccounts.role, 'SUPER_ADMIN'),
        eq(adminAccounts.enabled, true),
        isNull(users.disabledAt),
        ne(users.id, userId),
      ),
    )
    .limit(1);
  if (!other)
    throw new ConflictException('Нельзя отключить последнего SUPER_ADMIN.');
}
const pattern = (q: string) => '%' + q.trim().replace(/[\\%_]/g, '\\$&') + '%';
@Injectable()
export class AdminControl {
  constructor(
    @Inject(AdminAuth) private readonly auth: AdminAuth,
    @Inject(Passwords) private readonly passwords: Passwords,
  ) {}
  overview(p: AdminPrincipal) {
    return this.auth.withPermission(
      p,
      'overview.read',
      async (tx) =>
        (
          await tx.execute(sql`
      SELECT (SELECT count(*)::int FROM shops) AS shops,
      (SELECT count(*)::int FROM shops WHERE status='ACTIVE') AS active_shops,
      (SELECT count(*)::int FROM shops WHERE status='PENDING_VERIFICATION') AS pending_shops,
      (SELECT count(*)::int FROM shops WHERE status='SUSPENDED') AS suspended_shops,
      (SELECT count(DISTINCT user_id)::int FROM shop_members) AS sellers,
      (SELECT count(*)::int FROM products) AS products,
      (SELECT count(*)::int FROM products WHERE status='PUBLISHED') AS published_products,
      (SELECT count(*)::int FROM subscriptions WHERE status='ACTIVE') AS active_subscriptions,
      (SELECT count(*)::int FROM subscriptions WHERE status='PAST_DUE') AS past_due,
      (SELECT count(*)::int FROM subscriptions WHERE status='GRACE') AS grace,
      (SELECT count(*)::int FROM subscriptions WHERE status='SUSPENDED') AS suspended_subscriptions
    `)
        ).rows[0],
    );
  }
  listUsers(p: AdminPrincipal, query: ControlQueryDto) {
    return this.auth.withPermission(
      p,
      'users.read',
      async (tx) =>
        (
          await tx.execute(sql`
      SELECT u.id, u.email, u.disabled_at AS "disabledAt", u.created_at AS "createdAt", count(*) OVER()::int AS total,
      (SELECT count(*)::int FROM sessions s WHERE s.user_id=u.id AND s.revoked_at IS NULL AND s.expires_at>now()) AS "activeSessions"
      FROM users u WHERE u.email ILIKE ${pattern(query.q)} ORDER BY u.created_at DESC, u.id LIMIT 20 OFFSET ${(query.page - 1) * 20}
    `)
        ).rows,
    );
  }
  user(p: AdminPrincipal, id: string) {
    return this.auth.withPermission(p, 'users.read', async (tx) => {
      const [user] = await tx
        .select({
          id: users.id,
          email: users.email,
          disabledAt: users.disabledAt,
          createdAt: users.createdAt,
        })
        .from(users)
        .where(eq(users.id, id));
      if (!user) throw new NotFoundException();
      const memberships = await tx
        .select({
          id: shopMembers.id,
          shopId: shops.id,
          shopName: shops.name,
          role: shopMembers.role,
        })
        .from(shopMembers)
        .innerJoin(shops, eq(shops.id, shopMembers.shopId))
        .where(eq(shopMembers.userId, id))
        .limit(100);
      const sessions = (
        await tx.execute(
          sql`SELECT id, created_at AS "createdAt", expires_at AS "expiresAt" FROM sessions WHERE user_id=${id} AND revoked_at IS NULL AND expires_at>now() ORDER BY created_at DESC LIMIT 20`,
        )
      ).rows;
      return { user, memberships, sessions };
    });
  }
  userAction(
    p: AdminPrincipal,
    id: string,
    body: UserActionDto,
    requestId: string,
  ) {
    return this.auth.withPermission(p, 'users.write', async (tx) => {
      const [target] = await tx
        .select({ id: users.id })
        .from(users)
        .where(eq(users.id, id))
        .for('no key update');
      if (!target) throw new NotFoundException();
      if (body.action === 'DISABLE') {
        await protectLastSuperAdmin(tx, id);
        await tx
          .update(users)
          .set({ disabledAt: new Date(), updatedAt: new Date() })
          .where(eq(users.id, id));
        await revokeUserSessions(tx, id);
      } else if (body.action === 'ENABLE')
        await tx
          .update(users)
          .set({ disabledAt: null, updatedAt: new Date() })
          .where(eq(users.id, id));
      else if (body.action === 'REVOKE_SESSIONS')
        await revokeUserSessions(tx, id);
      else {
        if (!body.membershipId || !body.role) throw new BadRequestException();
        const [membership] = await tx
          .select()
          .from(shopMembers)
          .where(
            and(
              eq(shopMembers.id, body.membershipId),
              eq(shopMembers.userId, id),
            ),
          );
        if (!membership) throw new NotFoundException();
        await tx
          .select()
          .from(shops)
          .where(eq(shops.id, membership.shopId))
          .for('update');
        const [current] = await tx
          .select()
          .from(shopMembers)
          .where(
            and(
              eq(shopMembers.id, body.membershipId),
              eq(shopMembers.userId, id),
            ),
          )
          .for('update');
        if (!current) throw new NotFoundException();
        if (current.role === 'SHOP_OWNER' && body.role !== 'SHOP_OWNER') {
          const [other] = await tx
            .select({ id: shopMembers.id })
            .from(shopMembers)
            .where(
              and(
                eq(shopMembers.shopId, current.shopId),
                eq(shopMembers.role, 'SHOP_OWNER'),
                ne(shopMembers.id, current.id),
              ),
            );
          if (!other)
            throw new ConflictException(
              'В магазине должен оставаться владелец.',
            );
        }
        if (body.role === 'SHOP_OWNER' && current.role !== 'SHOP_OWNER') {
          const [owner] = await tx
            .select()
            .from(shopMembers)
            .where(
              and(
                eq(shopMembers.shopId, current.shopId),
                eq(shopMembers.role, 'SHOP_OWNER'),
              ),
            )
            .for('update');
          if (owner) {
            await tx
              .update(shopMembers)
              .set({ role: 'SHOP_MANAGER', updatedAt: new Date() })
              .where(eq(shopMembers.id, owner.id));
            await appendAudit(tx, {
              actor: 'USER:' + p.userId,
              action: 'SHOP_ROLE_CHANGED',
              resource: 'shop-member',
              resourceId: owner.id,
              reason: body.reason,
              requestId,
              result: 'SUCCESS',
            });
          }
        }
        await tx
          .update(shopMembers)
          .set({ role: body.role, updatedAt: new Date() })
          .where(eq(shopMembers.id, current.id));
      }
      await appendAudit(tx, {
        actor: 'USER:' + p.userId,
        action: (
          {
            DISABLE: 'USER_DISABLED',
            ENABLE: 'USER_ENABLED',
            REVOKE_SESSIONS: 'SESSION_REVOKED',
            SHOP_ROLE: 'SHOP_ROLE_CHANGED',
          } as Record<string, string>
        )[body.action]!,
        resource: body.action === 'SHOP_ROLE' ? 'shop-member' : 'user',
        resourceId: body.action === 'SHOP_ROLE' ? body.membershipId : id,
        reason: body.reason,
        requestId,
        result: 'SUCCESS',
      });
      return { updated: true };
    });
  }
  listProducts(p: AdminPrincipal, query: ControlQueryDto) {
    return this.auth.withPermission(
      p,
      'products.read',
      async (tx) =>
        (
          await tx.execute(sql`
      SELECT p.id,p.name,p.slug,p.status,p.moderation_hidden AS "moderationHidden",p.shop_id AS "shopId",s.name AS "shopName",count(*) OVER()::int AS total
      FROM products p JOIN shops s ON s.id=p.shop_id WHERE p.name ILIKE ${pattern(query.q)} OR s.name ILIKE ${pattern(query.q)}
      ORDER BY p.updated_at DESC,p.id LIMIT 20 OFFSET ${(query.page - 1) * 20}
    `)
        ).rows,
    );
  }
  product(p: AdminPrincipal, id: string) {
    return this.auth.withPermission(p, 'products.read', async (tx) => {
      const [product] = await tx
        .select({
          id: products.id,
          name: products.name,
          description: products.description,
          basePrice: products.basePrice,
          status: products.status,
          moderationHidden: products.moderationHidden,
          shopId: shops.id,
          shopName: shops.name,
        })
        .from(products)
        .innerJoin(shops, eq(shops.id, products.shopId))
        .where(eq(products.id, id));
      if (!product) throw new NotFoundException();
      return product;
    });
  }
  moderateProduct(
    p: AdminPrincipal,
    id: string,
    body: ProductModerationDto,
    requestId: string,
  ) {
    return this.auth.withPermission(p, 'products.moderate', async (tx) => {
      const [candidate] = await tx
        .select()
        .from(products)
        .where(eq(products.id, id));
      if (!candidate) throw new NotFoundException();
      await tx
        .select()
        .from(shops)
        .where(eq(shops.id, candidate.shopId))
        .for('update');
      const [member] = await tx
        .select({ id: shopMembers.id })
        .from(shopMembers)
        .where(
          and(
            eq(shopMembers.shopId, candidate.shopId),
            eq(shopMembers.userId, p.userId),
          ),
        );
      if (member) throw new ForbiddenException();
      const [product] = await tx
        .select()
        .from(products)
        .where(eq(products.id, id))
        .for('update');
      if (!product) throw new NotFoundException();
      if ((body.action === 'HIDE') === product.moderationHidden)
        throw new ConflictException();
      await tx
        .update(products)
        .set(
          body.action === 'HIDE'
            ? {
                moderationHidden: true,
                moderationPreviousStatus: product.status,
                status: 'DRAFT',
                updatedAt: new Date(),
              }
            : {
                moderationHidden: false,
                status: product.moderationPreviousStatus ?? 'DRAFT',
                moderationPreviousStatus: null,
                updatedAt: new Date(),
              },
        )
        .where(eq(products.id, id));
      await appendAudit(tx, {
        actor: 'USER:' + p.userId,
        action: body.action === 'HIDE' ? 'PRODUCT_HIDDEN' : 'PRODUCT_RESTORED',
        resource: 'product',
        resourceId: id,
        reason: body.reason,
        requestId,
        result: 'SUCCESS',
      });
      return { updated: true };
    });
  }
  subscriptions(p: AdminPrincipal, query: ControlQueryDto) {
    return this.auth.withPermission(
      p,
      'subscriptions.read',
      async (tx) =>
        (
          await tx.execute(sql`
      SELECT b.id,b.shop_id AS "shopId",s.name AS "shopName",b.plan,b.status,b.created_at AS "createdAt",b.period_start AS "periodStart",b.period_end AS "periodEnd",b.next_payment_at AS "nextPaymentAt",
      (SELECT jsonb_build_object('amountMinor',a.amount_minor,'status',a.status,'at',a.completed_at) FROM payment_attempts a WHERE a.subscription_id=b.id ORDER BY a.created_at DESC,a.id DESC LIMIT 1) AS "lastPayment",count(*) OVER()::int AS total
      FROM subscriptions b JOIN shops s ON s.id=b.shop_id WHERE s.name ILIKE ${pattern(query.q)} ORDER BY b.created_at DESC,b.id LIMIT 20 OFFSET ${(query.page - 1) * 20}
    `)
        ).rows,
    );
  }
  admins(p: AdminPrincipal, query: ControlQueryDto) {
    return this.auth.withPermission(
      p,
      'admins.write',
      async (tx) =>
        (
          await tx.execute(sql`
      SELECT u.id,u.email,a.role,a.enabled,a.must_change_password AS "mustChangePassword",(a.totp_encrypted IS NOT NULL) AS "mfaEnrolled",count(*) OVER()::int AS total
      FROM admin_accounts a JOIN users u ON u.id=a.user_id WHERE u.email ILIKE ${pattern(query.q)} ORDER BY a.created_at DESC,u.id LIMIT 20 OFFSET ${(query.page - 1) * 20}
    `)
        ).rows,
    );
  }
  createAdmin(p: AdminPrincipal, body: AdminCreateDto, requestId: string) {
    return this.auth.withPermission(p, 'admins.write', async (tx) => {
      const email = body.email.trim().toLowerCase();
      const [existing] = await tx
        .select({ id: users.id })
        .from(users)
        .where(eq(users.email, email));
      if (existing) throw new ConflictException();
      const [user] = await tx
        .insert(users)
        .values({
          email,
          passwordHash: await this.passwords.hash(body.temporaryPassword),
        })
        .returning({ id: users.id });
      if (!user) throw new Error('Admin insert failed');
      await tx
        .insert(adminAccounts)
        .values({ userId: user.id, role: body.role, mustChangePassword: true });
      await appendAudit(tx, {
        actor: 'USER:' + p.userId,
        action: 'ADMIN_CREATED',
        resource: 'user',
        resourceId: user.id,
        reason: body.reason,
        requestId,
        result: 'SUCCESS',
      });
      return { id: user.id };
    });
  }
  adminAction(
    p: AdminPrincipal,
    id: string,
    body: AdminActionDto,
    requestId: string,
  ) {
    return this.auth.withPermission(p, 'admins.write', async (tx) => {
      const [account] = await tx
        .select()
        .from(adminAccounts)
        .where(eq(adminAccounts.userId, id))
        .for('update');
      if (!account) throw new NotFoundException();
      if (
        body.action === 'DEACTIVATE' ||
        (body.action === 'CHANGE_ROLE' && body.role !== 'SUPER_ADMIN')
      )
        await protectLastSuperAdmin(tx, id);
      if (body.action === 'DEACTIVATE')
        await tx
          .update(adminAccounts)
          .set({ enabled: false, updatedAt: new Date() })
          .where(eq(adminAccounts.userId, id));
      if (body.action === 'CHANGE_ROLE') {
        if (!body.role) throw new BadRequestException();
        await tx
          .update(adminAccounts)
          .set({ role: body.role, updatedAt: new Date() })
          .where(eq(adminAccounts.userId, id));
      }
      await tx
        .update(adminSessions)
        .set({ revokedAt: new Date() })
        .where(
          and(eq(adminSessions.userId, id), isNull(adminSessions.revokedAt)),
        );
      await appendAudit(tx, {
        actor: 'USER:' + p.userId,
        action:
          body.action === 'DEACTIVATE'
            ? 'ADMIN_DEACTIVATED'
            : body.action === 'CHANGE_ROLE'
              ? 'ADMIN_ROLE_CHANGED'
              : 'SESSION_REVOKED',
        resource: 'user',
        resourceId: id,
        reason: body.reason,
        requestId,
        result: 'SUCCESS',
      });
      return { updated: true };
    });
  }
}
