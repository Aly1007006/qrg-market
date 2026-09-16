import type { MetadataRoute } from 'next';
import { indexingEnabled, siteOrigin } from '../lib/seo';
import { generateSitemaps } from './public-pages/sitemap';
export const dynamic = 'force-dynamic';
export default async function robots(): Promise<MetadataRoute.Robots> {
  if (!indexingEnabled()) return { rules: { userAgent: '*', disallow: '/' } };
  const origin = siteOrigin(process.env.QRG_SITE_URL)!;
  const parts = await generateSitemaps();
  return {
    rules: {
      userAgent: '*',
      allow: '/',
      disallow: ['/admin', '/seller', '/api/', '/catalog?'],
    },
    sitemap: [
      origin + '/sitemap.xml',
      ...parts.map((part) => `${origin}/public-pages/sitemap/${part.id}.xml`),
    ],
  };
}
