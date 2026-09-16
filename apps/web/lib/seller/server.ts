import 'server-only';
import { cookies } from 'next/headers';
import { redirect, notFound } from 'next/navigation';
import { apiOrigin, sessionCookie } from './boundary';
export async function sellerRead(path: string): Promise<unknown> {
  const response = await fetch(`${apiOrigin()}/api/v1/${path}`, {
    headers: { cookie: sessionCookie((await cookies()).toString()) },
    cache: 'no-store',
    redirect: 'error',
    signal: AbortSignal.timeout(8000),
  });
  if (response.status === 401) redirect('/seller/login');
  if (response.status === 403 || response.status === 404) notFound();
  if (!response.ok) throw new Error('Seller service unavailable');
  return response.json();
}
