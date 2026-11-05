import { createHmac, timingSafeEqual } from 'node:crypto';
import { ForbiddenException } from '@nestjs/common';
import type { Request } from 'express';
import type { AppConfig } from '../config.js';

const CLIENT_ID = 'x-qrg-client-id';
const CLIENT_PROOF = 'x-qrg-client-proof';
const MAX_CLOCK_SKEW_SECONDS = 60;

/**
 * The public Next.js boundary converts the ALB-provided client address into a
 * short-lived pseudonymous proof. Nest never stores or logs the raw address.
 */
export function clientIdentity(request: Request, config: AppConfig): string {
  const id = request.headers[CLIENT_ID];
  const proof = request.headers[CLIENT_PROOF];
  if (
    typeof id === 'string' &&
    /^[0-9a-f]{64}$/.test(id) &&
    typeof proof === 'string'
  ) {
    const [timestampText, signature, extra] = proof.split('.');
    const timestamp = Number(timestampText);
    if (
      !extra &&
      /^\d{10}$/.test(timestampText ?? '') &&
      /^[0-9a-f]{64}$/.test(signature ?? '') &&
      Math.abs(Math.floor(Date.now() / 1000) - timestamp) <=
        MAX_CLOCK_SKEW_SECONDS
    ) {
      const expected = createHmac('sha256', config.internalProxySecret)
        .update(`${timestampText}.${id}`)
        .digest();
      if (timingSafeEqual(expected, Buffer.from(signature!, 'hex')))
        return `proxy:${id}`;
    }
  }
  if (config.environment === 'production') throw new ForbiddenException();
  return `socket:${request.socket.remoteAddress ?? 'unknown'}`;
}
