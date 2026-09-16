export const uuidPattern =
  '[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}';
const id = uuidPattern;
const routes: [string, string][] = [
  [`shops/${id}/branding/(logo|cover)/images`, 'POST'],
  [`shops/${id}/branding/(logo|cover)/content`, 'GET'],
  [`shops/${id}/onboarding`, 'GET|PUT'],
  [`shops/${id}/product-drafts`, 'GET'],
  [`shops/${id}/product-drafts/${id}`, 'GET|PUT'],
  [`shops/${id}/product-drafts/${id}/materialize`, 'POST'],
  [`shops/${id}/product-actions`, 'POST'],
  [`shops/${id}/products/${id}/duplicate`, 'POST'],
  [`shops/${id}/products/${id}/image-order`, 'PUT'],
  [`shops/${id}/analytics`, 'GET'],
  [`shops/${id}/subscription`, 'GET|POST'],
  [`shops/${id}/subscription/(renew|cancel|disable-auto-renew)`, 'POST'],
  [`shops/${id}/verification`, 'GET|POST'],
  [`shops/${id}/requests`, 'GET'],
  [`shops/${id}/requests/${id}`, 'GET|PATCH'],
  [`shops/${id}/profile`, 'GET'],
  ['auth/(login|signup)', 'POST'],
  ['auth/me', 'GET'],
  ['auth/sessions', 'GET'],
  ['auth/(logout|session/rotate|sessions/revoke-all)', 'POST'],
  [`auth/sessions/${id}`, 'DELETE'],
  ['shops', 'GET|POST'],
  [`shops/${id}`, 'GET|PATCH'],
  [`shops/${id}/(location|contacts)`, 'PUT'],
  [`shops/${id}/members`, 'GET|POST'],
  [`shops/${id}/members/${id}`, 'PATCH|DELETE'],
  [`shops/${id}/products`, 'GET|POST'],
  [`shops/${id}/products/${id}`, 'GET|PUT'],
  [`shops/${id}/products/${id}/variants`, 'POST'],
  [`shops/${id}/products/${id}/variants/${id}`, 'PUT'],
  [`shops/${id}/products/${id}/images`, 'POST'],
  [`shops/${id}/products/${id}/images/${id}`, 'DELETE'],
  [`shops/${id}/products/${id}/images/${id}/content`, 'GET'],
];
export function allowedSellerRoute(path: string, method: string) {
  return routes.some(
    ([pattern, methods]) =>
      new RegExp(`^${pattern}$`).test(path) &&
      methods.split('|').includes(method),
  );
}
export function sessionCookie(raw: string | null) {
  return (raw ?? '')
    .split(';')
    .map((v) => v.trim())
    .filter((v) => /^(?:__Host-)?qrg_session=[A-Za-z0-9_-]{43}$/.test(v))
    .join('; ');
}
export function apiOrigin() {
  const url = new URL(process.env.QRG_API_ORIGIN ?? 'http://localhost:3001');
  if (
    !['http:', 'https:'].includes(url.protocol) ||
    url.username ||
    url.password ||
    url.pathname !== '/' ||
    url.search ||
    url.hash
  )
    throw new Error('Invalid QRG_API_ORIGIN');
  return url.origin;
}
