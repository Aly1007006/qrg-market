import {
  allowedAdminRoute,
  adminCookie,
  apiOrigin,
} from '../../../../lib/admin/boundary';
async function proxy(
  request: Request,
  context: { params: Promise<{ path: string[] }> },
) {
  const path = (await context.params).path.join('/');
  const fail = (status: number) =>
    Response.json(
      { statusCode: status, message: 'Не удалось выполнить запрос' },
      { status, headers: { 'cache-control': 'no-store' } },
    );
  if (!allowedAdminRoute(path, request.method)) return fail(404);
  const unsafe = request.method !== 'GET';
  const origin = process.env.QRG_APP_ORIGIN ?? 'http://localhost:3000';
  if (
    unsafe &&
    (request.headers.get('origin') !== origin ||
      request.headers.get('x-qrg-client') !== 'web' ||
      request.headers.get('sec-fetch-site') === 'cross-site')
  )
    return fail(403);
  if (
    unsafe &&
    !/^application\/json(?:;|$)/.test(request.headers.get('content-type') ?? '')
  )
    return fail(415);
  if (
    request.headers.get('content-encoding') ||
    Number(request.headers.get('content-length') ?? 0) > 8192
  )
    return fail(413);
  const query = new URL(request.url).searchParams;
  if ([...query.keys()].some((k) => !['page', 'status'].includes(k)))
    return fail(400);
  let bytes = 0;
  try {
    const body =
      unsafe && request.body
        ? request.body.pipeThrough(
            new TransformStream<Uint8Array, Uint8Array>({
              transform(chunk, c) {
                bytes += chunk.length;
                if (bytes > 8192) throw new Error('Payload limit');
                c.enqueue(chunk);
              },
            }),
          )
        : undefined;
    const init: RequestInit & { duplex: 'half' } = {
      method: request.method,
      headers: {
        cookie: adminCookie(request.headers.get('cookie')),
        ...(unsafe
          ? {
              origin,
              'content-type': 'application/json',
              'x-qrg-client': 'web',
              'x-qrg-csrf': request.headers.get('x-qrg-csrf') ?? '',
            }
          : {}),
      },
      ...(body ? { body } : {}),
      duplex: 'half',
      cache: 'no-store',
      redirect: 'error',
      signal: AbortSignal.any([request.signal, AbortSignal.timeout(10000)]),
    };
    const r = await fetch(`${apiOrigin()}/api/v1/admin/${path}?${query}`, init);
    const headers = new Headers({
      'cache-control': 'private, no-store',
      'content-type': 'application/json',
      'x-content-type-options': 'nosniff',
    });
    for (const cookie of r.headers.getSetCookie())
      if (/^(?:__Host-)?qrg_admin=/.test(cookie))
        headers.append('set-cookie', cookie);
    if (r.status === 429) headers.set('retry-after', '900');
    return new Response(r.body, { status: r.status, headers });
  } catch {
    return fail(bytes > 8192 ? 413 : 503);
  }
}
export { proxy as GET, proxy as POST, proxy as PATCH, proxy as DELETE };
