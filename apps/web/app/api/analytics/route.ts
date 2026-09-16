import { apiOrigin } from '../../../lib/seller/boundary';
const headers = {
  'cache-control': 'no-store',
  'x-content-type-options': 'nosniff',
};
const fail = (status: number) =>
  Response.json({ message: 'Analytics unavailable' }, { status, headers });
export async function POST(request: Request) {
  const origin = process.env.QRG_APP_ORIGIN ?? 'http://localhost:3000';
  if (
    request.headers.get('origin') !== origin ||
    request.headers.get('sec-fetch-site') === 'cross-site' ||
    request.headers.get('x-qrg-client') !== 'web'
  )
    return fail(403);
  if (
    !/^application\/json(?:;|$)/.test(request.headers.get('content-type') ?? '')
  )
    return fail(415);
  if (
    request.headers.get('content-encoding') ||
    Number(request.headers.get('content-length') ?? 0) > 1024
  )
    return fail(413);
  try {
    if (!request.body) return fail(400);
    const reader = request.body.getReader();
    const chunks: Uint8Array[] = [];
    let size = 0;
    while (true) {
      const part = await reader.read();
      if (part.done) break;
      size += part.value.length;
      if (size > 1024) {
        await reader.cancel();
        return fail(413);
      }
      chunks.push(part.value);
    }
    const response = await fetch(apiOrigin() + '/api/v1/public/analytics', {
      method: 'POST',
      headers: {
        origin,
        'x-qrg-client': 'web',
        'content-type': 'application/json',
      },
      body: Buffer.concat(chunks),
      cache: 'no-store',
      redirect: 'error',
      signal: AbortSignal.timeout(4000),
    });
    return new Response(response.body, { status: response.status, headers });
  } catch {
    return fail(503);
  }
}
