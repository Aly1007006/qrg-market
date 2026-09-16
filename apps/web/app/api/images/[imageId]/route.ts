import { apiOrigin, uuidPattern } from '../../../../lib/seller/boundary';
export async function GET(
  _request: Request,
  context: { params: Promise<{ imageId: string }> },
) {
  const { imageId } = await context.params;
  if (!new RegExp(`^${uuidPattern}$`).test(imageId))
    return new Response(null, { status: 404 });
  try {
    const response = await fetch(
      `${apiOrigin()}/api/v1/public/images/${imageId}`,
      {
        cache: 'no-store',
        redirect: 'error',
        signal: AbortSignal.timeout(25000),
      },
    );
    if (!response.ok)
      return new Response(null, {
        status: response.status,
        headers: { 'cache-control': 'no-store' },
      });
    return new Response(response.body, {
      headers: {
        'content-type': 'image/webp',
        'cache-control': 'no-store',
        'x-content-type-options': 'nosniff',
      },
    });
  } catch {
    return new Response(null, { status: 502 });
  }
}
