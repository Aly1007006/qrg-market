import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import {
  BadRequestException,
  Inject,
  Injectable,
  ServiceUnavailableException,
  type CanActivate,
  type ExecutionContext,
} from '@nestjs/common';
import type { Request } from 'express';
import { APP_CONFIG, type AppConfig } from '../config.js';
import { AuthRateLimiter } from '../auth/rate-limiter.js';
export function challengeFor(
  productId: string,
  secret: string,
  now = Date.now(),
) {
  const body = `${now}.${productId}.${randomBytes(16).toString('hex')}`;
  return (
    body +
    '.' +
    createHmac('sha256', secret)
      .update('lead-challenge:' + body)
      .digest('hex')
  );
}
export function verifyChallenge(
  token: string,
  productId: string,
  secret: string,
  now = Date.now(),
) {
  const parts = token.split('.');
  const timestamp = Number(parts[0]);
  const signature = parts[3] ?? '';
  if (
    parts.length !== 4 ||
    !/^\d{13}$/.test(parts[0] ?? '') ||
    parts[1] !== productId ||
    !/^[a-f0-9]{32}$/.test(parts[2] ?? '') ||
    !/^[a-f0-9]{64}$/.test(signature) ||
    now - timestamp < 2000 ||
    now - timestamp > 1800000
  )
    throw new BadRequestException();
  const expected = createHmac('sha256', secret)
    .update('lead-challenge:' + parts.slice(0, 3).join('.'))
    .digest();
  if (!timingSafeEqual(expected, Buffer.from(signature, 'hex')))
    throw new BadRequestException();
}
export abstract class CaptchaVerifier {
  abstract verify(input: {
    token?: string;
    productId: string;
    action: 'customer-request';
  }): Promise<void>;
}
@Injectable()
export class ConfiguredCaptchaPolicy extends CaptchaVerifier {
  private readonly required: boolean;
  constructor() {
    super();
    const setting = process.env.REQUEST_CAPTCHA_REQUIRED ?? 'false';
    if (!['true', 'false'].includes(setting))
      throw new Error('Invalid REQUEST_CAPTCHA_REQUIRED');
    this.required = setting === 'true';
  }
  verify(_input: {
    token?: string;
    productId: string;
    action: 'customer-request';
  }): Promise<void> {
    void _input;
    // No provider is simulated. Enabling CAPTCHA fails closed until a real adapter is configured.
    if (this.required)
      throw new ServiceUnavailableException(
        'CAPTCHA provider is not configured',
      );
    return Promise.resolve();
  }
}
@Injectable()
export class RequestSpamGuard implements CanActivate {
  constructor(
    @Inject(AuthRateLimiter) private readonly limiter: AuthRateLimiter,
  ) {}
  async canActivate(context: ExecutionContext) {
    const request = context.switchToHttp().getRequest<Request>();
    await this.limiter.consume(
      `lead:${request.method}:ip:${request.socket.remoteAddress ?? 'unknown'}`,
      request.method === 'GET' ? 120 : 30,
    );
    return true;
  }
}
@Injectable()
export class RequestFingerprint {
  constructor(@Inject(APP_CONFIG) private readonly config: AppConfig) {}
  hash(value: string) {
    return createHmac('sha256', this.config.rateLimitSecret)
      .update('lead:' + value)
      .digest('hex');
  }
  issue(productId: string) {
    return challengeFor(productId, this.config.rateLimitSecret);
  }
  verify(token: string, productId: string) {
    verifyChallenge(token, productId, this.config.rateLimitSecret);
  }
}
