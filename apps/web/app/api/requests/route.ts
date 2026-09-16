import { apiOrigin, uuidPattern } from '../../../lib/seller/boundary';
const headers = {
  'cache-control': 'no-store',
  'content-type': 'application/json',
  'x-content-type-options': 'nosniff',
};
const fail = (status: number) =>
  Response.json(
    { statusCode: status, message: 'Не удалось отправить заявку' },
    { status, headers },
  );
export async function GET(request: Request) {
  const query = new URL(request.url).searchParams;
  const product = query.get('productId') ?? '';
  if (query.size !== 1 || !new RegExp(`^${uuidPattern}$`).test(product))
    return fail(400);
  try {
    const r = await fetch(
      `${apiOrigin()}/api/v1/public/requests/challenge/${product}`,
      {
        cache: 'no-store',
        redirect: 'error',
        signal: AbortSignal.timeout(8000),
      },
    );
    return new Response(r.body, { status: r.status, headers });
  } catch {
    return fail(503);
  }
}
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
    Number(request.headers.get('content-length') ?? 0) > 8192 ||
    request.headers.get('content-encoding')
  )
    return fail(413);
  try {
    if (!request.body) return fail(400);
    const reader = request.body.getReader();
    const chunks: Uint8Array[] = [];
    let length = 0;
    while (true) {
      const part = await reader.read();
      if (part.done) break;
      length += part.value.length;
      if (length > 8192) {
        await reader.cancel();
        return fail(413);
      }
      chunks.push(part.value);
    }
    const response = await fetch(`${apiOrigin()}/api/v1/public/requests`, {
      method: 'POST',
      headers: {
        origin,
        'x-qrg-client': 'web',
        'content-type': 'application/json',
      },
      body: Buffer.concat(chunks),
      cache: 'no-store',
      redirect: 'error',
      signal: AbortSignal.timeout(10000),
    });
    return new Response(response.body, {
      status: response.status,
      headers: {
        ...headers,
        ...(response.status === 429 ? { 'retry-after': '900' } : {}),
      },
    });
  } catch {
    return fail(503);
  }
}
