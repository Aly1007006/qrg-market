import {
  createParamDecorator,
  SetMetadata,
  UnauthorizedException,
  type ExecutionContext,
} from '@nestjs/common';
import type { Request } from 'express';

export const PUBLIC_ROUTE = Symbol('PUBLIC_ROUTE');
export const IMAGE_UPLOAD_ROUTE = Symbol('IMAGE_UPLOAD_ROUTE');
export const Public = () => SetMetadata(PUBLIC_ROUTE, true);
export const AUTH_THROTTLE = Symbol('AUTH_THROTTLE');
export type AuthAction = 'signup' | 'login' | 'reset-request' | 'reset-confirm';
export const AuthThrottle = (action: AuthAction) =>
  SetMetadata(AUTH_THROTTLE, action);

export interface Principal {
  readonly userId: string;
  readonly sessionId: string;
  readonly tokenHash: string;
  readonly csrfToken: string;
  readonly expiresAt: Date;
}
export interface AuthenticatedRequest extends Request {
  principal?: Principal;
}
export const CurrentSession = createParamDecorator(
  (_data: unknown, context: ExecutionContext): Principal => {
    const principal = context
      .switchToHttp()
      .getRequest<AuthenticatedRequest>().principal;
    if (!principal) throw new UnauthorizedException();
    return principal;
  },
);
