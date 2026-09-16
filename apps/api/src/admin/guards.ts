import {
  ForbiddenException,
  Inject,
  Injectable,
  type CanActivate,
  type ExecutionContext,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import { APP_CONFIG, type AppConfig } from '../config.js';
import { AuthRateLimiter } from '../auth/rate-limiter.js';
import { matchesCsrf } from '../auth/tokens.js';
import { AdminAuth } from './auth.js';
import { AuditLog } from './audit.js';
import {
  ADMIN_AREA,
  ADMIN_PERMISSION,
  type AdminPermission,
  type AdminRequest,
} from './metadata.js';
import { readAdminToken } from './security.js';
@Injectable()
export class AdminGuard implements CanActivate {
  constructor(
    @Inject(Reflector) private readonly reflector: Reflector,
    @Inject(AdminAuth) private readonly auth: AdminAuth,
    @Inject(AuditLog) private readonly audit: AuditLog,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}
  async canActivate(ctx: ExecutionContext) {
    if (!this.reflector.get<boolean>(ADMIN_AREA, ctx.getClass())) return true;
    const req = ctx.switchToHttp().getRequest<AdminRequest>();
    let actor = 'ANONYMOUS';
    try {
      const p = await this.auth.authenticate(readAdminToken(req, this.config));
      actor = 'USER:' + p.userId;
      const permission = this.reflector.get<AdminPermission>(
        ADMIN_PERMISSION,
        ctx.getHandler(),
      );
      if (!permission) throw new ForbiddenException(); // No implicit permission for future admin routes.
      await this.auth.withPermission(p, permission, () => undefined);
      if (
        !['GET', 'HEAD', 'OPTIONS'].includes(req.method) &&
        !matchesCsrf(req.headers['x-qrg-csrf'], p.csrfToken)
      )
        throw new ForbiddenException();
      req.admin = p;
      return true;
    } catch (e) {
      await this.audit.append({
        actor,
        action: 'ADMIN_ACCESS',
        resource: 'admin-area',
        result: 'DENIED',
      });
      throw e;
    }
  }
}
@Injectable()
export class AdminLoginThrottle implements CanActivate {
  constructor(
    @Inject(AuthRateLimiter) private readonly limiter: AuthRateLimiter,
  ) {}
  async canActivate(ctx: ExecutionContext) {
    const req = ctx.switchToHttp().getRequest<Request>();
    await this.limiter.consume(
      'admin-login:ip:' + (req.socket.remoteAddress ?? 'unknown'),
      30,
    );
    const body: unknown = req.body;
    if (
      body &&
      typeof body === 'object' &&
      'email' in body &&
      typeof body.email === 'string'
    )
      await this.limiter.consume(
        'admin-login:email:' + body.email.trim().toLowerCase().slice(0, 254),
        5,
      );
    return true;
  }
}
