import type { MetadataRoute } from 'next';
import { indexingEnabled, siteOrigin } from '../../lib/seo';
import { publicApi } from '../../lib/catalogue/repository';
import { array, record, string, number } from '../../lib/catalogue/contract';
export const dynamic = 'force-dynamic';
export async function generateSitemaps() {
  if (!indexingEnabled()) return [];
  const total = number(record(await publicApi('seo/count')).total);
  return Array.from({ length: Math.ceil(total / 1000) }, (_, id) => ({ id }));
}
export default async function sitemap({
  id,
}: {
  id: Promise<string>;
}): Promise<MetadataRoute.Sitemap> {
  if (!indexingEnabled()) return [];
  const part = await id;
  if (!/^\d{1,5}$/.test(part)) return [];
  const origin = siteOrigin(process.env.QRG_SITE_URL)!;
  return array(await publicApi('seo/entries?page=' + (Number(part) + 1)))
    .map(record)
    .map((item) => {
      const path = string(item.path);
      if (!/^\/(product|shop)\/[a-z0-9]+(-[a-z0-9]+)*$/.test(path))
        throw new Error('Invalid sitemap path');
      return {
        url: origin + path,
        lastModified: new Date(string(item.updatedAt)),
      };
    });
}
