import type { MetadataRoute } from 'next';
import { indexingEnabled, siteOrigin } from '../lib/seo';
export const dynamic = 'force-dynamic';
export default function sitemap(): MetadataRoute.Sitemap {
  if (!indexingEnabled()) return [];
  const origin = siteOrigin(process.env.QRG_SITE_URL);
  if (!origin) return [];
  return [{ url: origin + '/' }, { url: origin + '/catalog' }];
}
