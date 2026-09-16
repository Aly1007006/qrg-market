import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { and, eq } from 'drizzle-orm';
import { AuthService } from '../auth/service.js';
import type { Principal } from '../auth/metadata.js';
import type { Transaction } from '../database.js';
import { shopMembers, shops } from '../db/schema.js';
import { requirePermission, type Permission } from './permissions.js';

@Injectable()
export class ShopAuthorization {
  constructor(@Inject(AuthService) private readonly auth: AuthService) {}

  withShop<T>(
    principal: Principal,
    shopId: string,
    permission: Permission,
    action: (tx: Transaction, shop: typeof shops.$inferSelect) => Promise<T>,
  ): Promise<T> {
    return this.auth.withSession(principal, async (tx) => {
      // Preliminary tenant check avoids locking another seller's shop on an invalid request.
      const [visible] = await tx
        .select({ id: shopMembers.id })
        .from(shopMembers)
        .where(
          and(
            eq(shopMembers.shopId, shopId),
            eq(shopMembers.userId, principal.userId),
          ),
        );
      if (!visible) throw new NotFoundException();
      const [shop] = await tx
        .select()
        .from(shops)
        .where(eq(shops.id, shopId))
        .for('update');
      if (!shop) throw new NotFoundException();
      // Re-read AFTER the shop lock: a waiting request must see committed role changes/removal.
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
      requirePermission(membership.role, permission);
      return action(tx, shop);
    });
  }
}
