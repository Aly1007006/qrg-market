import {
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { and, eq, isNull } from 'drizzle-orm';
import { AuthService } from '../auth/service.js';
import type { Principal } from '../auth/metadata.js';
import { shopMembers, shops, users } from '../db/schema.js';
import type { Transaction } from '../database.js';
import type { Permission } from '../authorization/permissions.js';
import { ShopAuthorization } from '../authorization/shop-authorization.js';
import type { AddMemberDto, ListQueryDto, MemberRoleDto } from './dto.js';
import { requireEditableShopIdentity } from '../admin/moderation.js';

@Injectable()
export class ShopsService {
  constructor(
    @Inject(AuthService) private readonly auth: AuthService,
    @Inject(ShopAuthorization)
    private readonly authorization: ShopAuthorization,
  ) {}

  private access<T>(
    principal: Principal,
    shopId: string,
    permission: Permission,
    action: (tx: Transaction, shop: typeof shops.$inferSelect) => Promise<T>,
  ): Promise<T> {
    return this.authorization.withShop(principal, shopId, permission, action);
  }

  list(principal: Principal, query: ListQueryDto) {
    return this.auth.withSession(principal, (tx) =>
      tx
        .select({
          id: shops.id,
          name: shops.name,
          status: shops.status,
          role: shopMembers.role,
        })
        .from(shopMembers)
        .innerJoin(shops, eq(shops.id, shopMembers.shopId))
        .where(eq(shopMembers.userId, principal.userId))
        .orderBy(shops.createdAt, shops.id)
        .limit(query.limit)
        .offset(query.offset),
    );
  }
  create(principal: Principal, name: string) {
    return this.auth.withSession(principal, async (tx) => {
      const [shop] = await tx
        .insert(shops)
        .values({ name, status: 'DRAFT' })
        .returning();
      if (!shop) throw new Error('Shop insert failed');
      await tx.insert(shopMembers).values({
        shopId: shop.id,
        userId: principal.userId,
        role: 'SHOP_OWNER',
      });
      return shop;
    });
  }
  get(principal: Principal, shopId: string) {
    return this.access(principal, shopId, 'shop.read', async (tx, shop) => {
      const [membership] = await tx
        .select({ role: shopMembers.role })
        .from(shopMembers)
        .where(
          and(
            eq(shopMembers.shopId, shop.id),
            eq(shopMembers.userId, principal.userId),
          ),
        );
      if (!membership) throw new NotFoundException();
      return { ...shop, role: membership.role };
    });
  }
  rename(principal: Principal, shopId: string, name: string) {
    return this.access(
      principal,
      shopId,
      'shop.settings.write',
      async (tx, shop) => {
        requireEditableShopIdentity(shop.status);
        const [updated] = await tx
          .update(shops)
          .set({ name })
          .where(eq(shops.id, shop.id))
          .returning();
        if (!updated) throw new NotFoundException();
        return updated;
      },
    );
  }
  members(principal: Principal, shopId: string, query: ListQueryDto) {
    return this.access(principal, shopId, 'members.read', (tx, shop) =>
      tx
        .select()
        .from(shopMembers)
        .where(eq(shopMembers.shopId, shop.id))
        .orderBy(shopMembers.createdAt, shopMembers.id)
        .limit(query.limit)
        .offset(query.offset),
    );
  }
  member(principal: Principal, shopId: string, memberId: string) {
    return this.access(principal, shopId, 'members.read', async (tx, shop) => {
      const [member] = await tx
        .select()
        .from(shopMembers)
        .where(
          and(eq(shopMembers.id, memberId), eq(shopMembers.shopId, shop.id)),
        );
      if (!member) throw new NotFoundException();
      return member;
    });
  }
  addMember(principal: Principal, shopId: string, body: AddMemberDto) {
    return this.access(principal, shopId, 'members.write', async (tx, shop) => {
      const [user] = await tx
        .select({ id: users.id })
        .from(users)
        .where(and(eq(users.id, body.userId), isNull(users.disabledAt)));
      if (!user) throw new NotFoundException();
      const [member] = await tx
        .insert(shopMembers)
        .values({ shopId: shop.id, userId: user.id, role: body.role })
        .onConflictDoNothing({
          target: [shopMembers.shopId, shopMembers.userId],
        })
        .returning();
      if (!member) throw new ConflictException();
      return member;
    });
  }
  changeRole(
    principal: Principal,
    shopId: string,
    memberId: string,
    body: MemberRoleDto,
  ) {
    return this.access(principal, shopId, 'members.write', async (tx, shop) => {
      const [member] = await tx
        .select()
        .from(shopMembers)
        .where(
          and(eq(shopMembers.id, memberId), eq(shopMembers.shopId, shop.id)),
        );
      if (!member) throw new NotFoundException();
      // Ownership transfer is a separate future flow, never a generic role update.
      if (member.role === 'SHOP_OWNER') throw new ForbiddenException();
      const [updated] = await tx
        .update(shopMembers)
        .set({ role: body.role })
        .where(
          and(eq(shopMembers.id, member.id), eq(shopMembers.shopId, shop.id)),
        )
        .returning();
      return updated;
    });
  }
  async removeMember(
    principal: Principal,
    shopId: string,
    memberId: string,
  ): Promise<void> {
    await this.access(principal, shopId, 'members.write', async (tx, shop) => {
      const [member] = await tx
        .select()
        .from(shopMembers)
        .where(
          and(eq(shopMembers.id, memberId), eq(shopMembers.shopId, shop.id)),
        );
      if (!member) throw new NotFoundException();
      if (member.role === 'SHOP_OWNER') throw new ForbiddenException();
      await tx
        .delete(shopMembers)
        .where(
          and(eq(shopMembers.id, member.id), eq(shopMembers.shopId, shop.id)),
        );
    });
  }
}
