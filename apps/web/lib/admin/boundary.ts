import { uuidPattern } from '../seller/boundary.ts';
export { apiOrigin } from '../seller/boundary.ts';
const routes: [string, string][] = [
  ['overview', 'GET'],
  ['auth/(password|mfa/setup|mfa/verify)', 'POST'],
  ['(users|products|subscriptions|administrators)', 'GET'],
  [`(users|products)/${uuidPattern}`, 'GET'],
  [`users/${uuidPattern}/actions`, 'POST'],
  [`products/${uuidPattern}/moderation`, 'POST'],
  ['administrators', 'POST'],
  [`administrators/${uuidPattern}/actions`, 'POST'],
  ['auth/login', 'POST'],
  ['auth/me', 'GET'],
  ['auth/(logout|rotate)', 'POST'],
  ['dashboard', 'GET'],
  ['shops', 'GET'],
  [`shops/${uuidPattern}`, 'GET'],
  [`shops/${uuidPattern}/decisions`, 'POST'],
  ['audit', 'GET'],
];
export function allowedAdminRoute(path: string, method: string) {
  return routes.some(
    ([pattern, methods]) =>
      new RegExp(`^${pattern}$`).test(path) && methods === method,
  );
}
export function adminCookie(raw: string | null) {
  return (raw ?? '')
    .split(';')
    .map((v) => v.trim())
    .filter((v) => /^(?:__Host-)?qrg_admin=[A-Za-z0-9_-]{43}$/.test(v))
    .join('; ');
}
