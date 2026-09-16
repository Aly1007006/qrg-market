import {
  ForbiddenException,
  Inject,
  Injectable,
  UnsupportedMediaTypeException,
  type CanActivate,
  type ExecutionContext,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import { APP_CONFIG, type AppConfig } from '../config.js';
import { AuthService } from './service.js';
import {
  AUTH_THROTTLE,
  IMAGE_UPLOAD_ROUTE,
  PUBLIC_ROUTE,
  type AuthAction,
  type AuthenticatedRequest,
} from './metadata.js';
import { AuthRateLimiter } from './rate-limiter.js';
import { matchesCsrf, readSessionToken } from './tokens.js';
import { ADMIN_AREA } from '../admin/metadata.js';

const unsafe = (request: Request) =>
  !['GET', 'HEAD', 'OPTIONS'].includes(request.method);

@Injectable()
export class RequestSecurityGuard implements CanActivate {
  constructor(
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    @Inject(Reflector) private readonly reflector: Reflector,
  ) {}
  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<Request>();
    if (!unsafe(request)) return true;
    if (
      request.headers.origin !== this.config.appOrigin ||
      request.headers['sec-fetch-site'] === 'cross-site' ||
      request.headers['x-qrg-client'] !== 'web'
    ) {
      throw new ForbiddenException();
    }
    const upload = this.reflector.get<boolean>(
      IMAGE_UPLOAD_ROUTE,
      context.getHandler(),
    );
    if (!request.is(upload ? 'multipart/form-data' : 'application/json'))
      throw new UnsupportedMediaTypeException();
    return true;
  }
}

@Injectable()
export class AuthThrottleGuard implements CanActivate {
  constructor(
    @Inject(Reflector) private readonly reflector: Reflector,
    @Inject(AuthRateLimiter) private readonly limiter: AuthRateLimiter,
  ) {}
  async canActivate(context: ExecutionContext): Promise<boolean> {
    const action = this.reflector.getAllAndOverride<AuthAction | undefined>(
      AUTH_THROTTLE,
      [context.getHandler(), context.getClass()],
    );
    if (!action) return true;
    const request = context.switchToHttp().getRequest<Request>();
    const body: unknown = request.body;
    const email =
      body &&
      typeof body === 'object' &&
      'email' in body &&
      typeof body.email === 'string'
        ? body.email.trim().toLowerCase().slice(0, 254)
        : undefined;
    // Forwarded headers are untrusted. Configure a trusted reverse-proxy boundary separately at deployment.
    await this.limiter.check(
      action,
      request.socket.remoteAddress ?? 'unknown',
      email,
    );
    return true;
  }
}

@Injectable()
export class SessionGuard implements CanActivate {
  constructor(
    @Inject(Reflector) private readonly reflector: Reflector,
    @Inject(AuthService) private readonly auth: AuthService,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}
  async canActivate(context: ExecutionContext): Promise<boolean> {
    if (this.reflector.get<boolean>(ADMIN_AREA, context.getClass()))
      return true;
    if (
      this.reflector.getAllAndOverride<boolean>(PUBLIC_ROUTE, [
        context.getHandler(),
        context.getClass(),
      ])
    )
      return true;
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const principal = await this.auth.authenticate(
      readSessionToken(request, this.config),
    );
    if (
      unsafe(request) &&
      !matchesCsrf(request.headers['x-qrg-csrf'], principal.csrfToken)
    )
      throw new ForbiddenException();
    request.principal = principal;
    return true;
  }
}
