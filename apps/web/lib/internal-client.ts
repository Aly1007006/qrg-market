import 'server-only';
import { createHmac } from 'node:crypto';
import { trustedProxyAddress } from './client-address';

const localSecret = 'local-development-internal-proxy-key-not-for-production';

function secret(): string {
  const value =
    process.env.QRG_INTERNAL_PROXY_SECRET ??
    (process.env.NODE_ENV === 'production' ? '' : localSecret);
  if (
    value.length < 32 ||
    value.length > 128 ||
    (process.env.NODE_ENV === 'production' && value === localSecret)
  )
    throw new Error('QRG_INTERNAL_PROXY_SECRET is not configured');
  return value;
}

function sourceAddress(request: Request): string {
  return trustedProxyAddress(
    request.headers.get('x-forwarded-for'),
    process.env.NODE_ENV,
  );
}

/** Send only a rotating HMAC pseudonym to the private API, never the raw IP. */
export function internalClientHeaders(
  request: Request,
): Record<string, string> {
  const key = secret();
  const id = createHmac('sha256', key)
    .update('qrg-client\0' + sourceAddress(request))
    .digest('hex');
  const timestamp = Math.floor(Date.now() / 1000).toString();
  const signature = createHmac('sha256', key)
    .update(`${timestamp}.${id}`)
    .digest('hex');
  return {
    'x-qrg-client-id': id,
    'x-qrg-client-proof': `${timestamp}.${signature}`,
  };
}
