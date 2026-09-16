import {
  createParamDecorator,
  SetMetadata,
  UnauthorizedException,
  type ExecutionContext,
} from '@nestjs/common';
import type { Request } from 'express';
export const ADMIN_AREA = Symbol('ADMIN_AREA');
export const ADMIN_PERMISSION = Symbol('ADMIN_PERMISSION');
export const AdminArea = () => SetMetadata(ADMIN_AREA, true);
export type AdminPermission =
  | 'session'
  | 'security'
  | 'overview.read'
  | 'users.read'
  | 'users.write'
  | 'products.read'
  | 'products.moderate'
  | 'subscriptions.read'
  | 'admins.write'
  | 'moderation.read'
  | 'moderation.write'
  | 'moderation.suspend'
  | 'audit.read';
export const AdminAccess = (permission: AdminPermission) =>
  SetMetadata(ADMIN_PERMISSION, permission);
export interface AdminPrincipal {
  kind: 'ADMIN';
  userId: string;
  sessionId: string;
  tokenHash: string;
  csrfToken: string;
}
export interface AdminRequest extends Request {
  admin?: AdminPrincipal;
}
export const CurrentAdmin = createParamDecorator(
  (_data: unknown, context: ExecutionContext): AdminPrincipal => {
    const p = context.switchToHttp().getRequest<AdminRequest>().admin;
    if (!p) throw new UnauthorizedException();
    return p;
  },
);
