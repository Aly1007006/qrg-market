import { isIP } from 'node:net';

/**
 * The nearest trusted reverse proxy appends (or replaces) X-Forwarded-For.
 * Browser-controlled values are therefore on the left and must never be used
 * as the rate-limit identity. Direct production access is intentionally
 * rejected by the surrounding private-network deployment contract.
 */
export function trustedProxyAddress(
  forwardedFor: string | null,
  environment: string | undefined,
) {
  const last = forwardedFor
    ?.split(',')
    .map((value) => value.trim())
    .filter(Boolean)
    .at(-1);
  if (last && isIP(last)) return last;
  if (environment === 'production')
    throw new Error('Trusted proxy client address is missing');
  return 'local-development-client';
}
