import 'server-only';
import { cookies } from 'next/headers';
import { redirect, notFound } from 'next/navigation';
import { adminCookie, apiOrigin, allowedAdminRoute } from './boundary';
export async function adminRead(path: string): Promise<unknown> {
  if (!allowedAdminRoute(path.split('?')[0] ?? '', 'GET')) notFound();
  const r = await fetch(`${apiOrigin()}/api/v1/admin/${path}`, {
    headers: { cookie: adminCookie((await cookies()).toString()) },
    cache: 'no-store',
    redirect: 'error',
    signal: AbortSignal.timeout(8000),
  });
  if (r.status === 401) redirect('/admin/login');
  if (r.status === 403 || r.status === 404) notFound();
  if (!r.ok) throw new Error('Admin service unavailable');
  return r.json();
}
