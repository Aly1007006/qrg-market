import { ForbiddenException } from '@nestjs/common';
import type { ShopRole } from '../db/schema.js';

export const permissions = [
  'analytics.read',
  'subscription.read',
  'subscription.write',
  'shop.read',
  'shop.settings.write',
  'members.read',
  'members.write',
  'products.read',
  'products.write',
  'requests.read',
  'requests.write',
] as const;
export type Permission = (typeof permissions)[number];
const grants: Record<ShopRole, readonly Permission[]> = {
  SHOP_OWNER: permissions,
  SHOP_MANAGER: [
    'analytics.read',
    'shop.read',
    'products.read',
    'products.write',
    'requests.read',
    'requests.write',
  ],
  SHOP_EMPLOYEE: [
    'shop.read',
    'products.read',
    'products.write',
    'requests.read',
    'requests.write',
  ],
};

export function hasPermission(role: ShopRole, permission: Permission): boolean {
  return Object.hasOwn(grants, role) && grants[role].includes(permission);
}
export function requirePermission(
  role: ShopRole,
  permission: Permission,
): void {
  if (!hasPermission(role, permission)) throw new ForbiddenException();
}
