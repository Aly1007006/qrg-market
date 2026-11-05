import { Buffer } from 'node:buffer';
import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';
import {
  contentSecurityPolicy,
  strictTransportSecurity,
} from './lib/security-headers';

export function proxy(request: NextRequest) {
  const nonce = Buffer.from(crypto.randomUUID()).toString('base64');
  const csp = contentSecurityPolicy(
    nonce,
    process.env.NODE_ENV,
    process.env.QRG_MEDIA_ORIGIN,
  );
  const requestHeaders = new Headers(request.headers);
  // Browser input is overwritten. Next reads these trusted request headers and
  // applies the nonce to framework runtime scripts and styles.
  requestHeaders.set('x-nonce', nonce);
  requestHeaders.set('content-security-policy', csp);
  const response = NextResponse.next({ request: { headers: requestHeaders } });
  response.headers.set('content-security-policy', csp);
  const hsts = strictTransportSecurity(
    process.env.NODE_ENV,
    process.env.QRG_HSTS_ENABLED,
    process.env.QRG_APP_ORIGIN,
  );
  if (hsts) response.headers.set('strict-transport-security', hsts);
  return response;
}

export const config = {
  matcher: [
    {
      source: '/((?!_next/static|_next/image|icon.svg|favicon.ico).*)',
      missing: [
        { type: 'header', key: 'next-router-prefetch' },
        { type: 'header', key: 'purpose', value: 'prefetch' },
      ],
    },
  ],
};
