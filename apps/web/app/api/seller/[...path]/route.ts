import {
  allowedSellerRoute,
  apiOrigin,
  sessionCookie,
} from '../../../../lib/seller/boundary';
export const runtime = 'nodejs';
async function proxy(
  request: Request,
  context: { params: Promise<{ path: string[] }> },
) {
  const path = (await context.params).path.join('/');
  const fail = (status: number) =>
    Response.json(
      { message: 'Не удалось выполнить запрос', statusCode: status },
      { status, headers: { 'Cache-Control': 'no-store' } },
    );
  if (!allowedSellerRoute(path, request.method)) return fail(404);
  const unsafe = request.method !== 'GET';
  const trustedOrigin = process.env.QRG_APP_ORIGIN ?? 'http://localhost:3000';
  if (
    unsafe &&
    (request.headers.get('origin') !== trustedOrigin ||
      request.headers.get('sec-fetch-site') === 'cross-site' ||
      request.headers.get('x-qrg-client') !== 'web')
  )
    return fail(403);
  const upload = request.method === 'POST' && path.endsWith('/images');
  const type = request.headers.get('content-type') ?? '';
  if (
    unsafe &&
    !(upload
      ? /^multipart\/form-data; boundary=/.test(type)
      : /^application\/json(?:;|$)/.test(type))
  )
    return fail(415);
  const maximum = upload ? 10 * 1024 * 1024 + 65536 : 32768;
  if (Number(request.headers.get('content-length') ?? 0) > maximum)
    return fail(413);
  const headers = new Headers({
    cookie: sessionCookie(request.headers.get('cookie')),
  });
  if (unsafe) {
    headers.set('origin', trustedOrigin);
    headers.set('x-qrg-client', 'web');
    headers.set('content-type', type);
    headers.set('x-qrg-csrf', request.headers.get('x-qrg-csrf') ?? '');
  }
  const query = new URL(request.url).searchParams;
  if (
    [...query.keys()].some(
      (k) => !['page', 'limit', 'offset', 'status'].includes(k),
    )
  )
    return fail(400);
  try {
    // Stream with a hard byte budget, including chunked requests. Never buffer multipart in Next.
    let bytes = 0;
    const body =
      unsafe && request.body
        ? request.body.pipeThrough(
            new TransformStream<Uint8Array, Uint8Array>({
              transform(chunk, controller) {
                bytes += chunk.length;
                if (bytes > maximum) throw new Error('Payload limit');
                controller.enqueue(chunk);
              },
            }),
          )
        : undefined;
    const init: RequestInit & { duplex: 'half' } = {
      method: request.method,
      headers,
      ...(body ? { body } : {}),
      duplex: 'half',
      cache: 'no-store',
      redirect: 'error',
      signal: AbortSignal.any([request.signal, AbortSignal.timeout(45000)]),
    };
    const upstream = await fetch(
      `${apiOrigin()}/api/v1/${path}?${query}`,
      init,
    );
    const outgoing = new Headers({
      'cache-control': 'private, no-store',
      'x-content-type-options': 'nosniff',
      'content-type':
        upstream.headers.get('content-type') ?? 'application/json',
    });
    for (const cookie of upstream.headers.getSetCookie()) {
      if (/^(?:__Host-)?qrg_session=/.test(cookie))
        outgoing.append('set-cookie', cookie);
    }
    return new Response(upstream.body, {
      status: upstream.status,
      headers: outgoing,
    });
  } catch {
    return fail(502);
  }
}
export {
  proxy as GET,
  proxy as POST,
  proxy as PUT,
  proxy as PATCH,
  proxy as DELETE,
};
