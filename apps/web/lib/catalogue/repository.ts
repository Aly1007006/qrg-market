import 'server-only';
import { cache } from 'react';
import { connection } from 'next/server';
import { notFound } from 'next/navigation';
import {
  EMPTY_CATALOGUE,
  fixturesEnabled,
  filterProducts,
  parseFilters,
  publicProducts,
  type Catalogue,
  type Filters,
} from './model';
import {
  array,
  record,
  string,
  number,
  parseProduct,
  parseShop,
} from './contract';
export function catalogueMode() {
  return fixturesEnabled(process.env.NODE_ENV, process.env.QRG_DEV_FIXTURES)
    ? 'fixtures'
    : process.env.QRG_API_ORIGIN
      ? 'live'
      : 'unavailable';
}
export async function publicApi(path: string): Promise<unknown> {
  const origin = new URL(process.env.QRG_API_ORIGIN ?? '');
  if (
    !['http:', 'https:'].includes(origin.protocol) ||
    origin.username ||
    origin.password ||
    origin.pathname !== '/' ||
    origin.search ||
    origin.hash
  )
    throw new Error('Invalid API origin');
  // Paths are created only by this server adapter, never supplied by a browser.
  const response = await fetch(origin.origin + '/api/v1/public/' + path, {
    cache: 'no-store',
    redirect: 'error',
    signal: AbortSignal.timeout(8000),
  });
  if (response.status === 404) return null;
  if (!response.ok) throw new Error('Catalog temporarily unavailable');
  return response.json() as Promise<unknown>;
}
const metadata = cache(async () => {
  const [categoryData, facetData, shopData] = await Promise.all([
    publicApi('categories'),
    publicApi('filters'),
    publicApi('shops?limit=100'),
  ]);
  const f = record(facetData);
  return {
    categories: array(categoryData)
      .filter((c) => record(c).parentId === null)
      .map((c) => {
        const r = record(c);
        return {
          slug: string(r.slug),
          name: string(r.name),
          note: string(r.note),
        };
      }),
    facets: {
      shops: array(f.shops).map((item) => {
        const s = record(item);
        return { slug: string(s.slug), name: string(s.name) };
      }),
      brands: array(f.brands).map(string),
      subcategories: array(f.subcategories).map(string),
      malls: array(f.malls).map(string),
      sizes: array(f.sizes).map(string),
      colors: array(f.colors).map(string),
    },
    shops: array(shopData).map(parseShop),
  };
});
export async function queryCatalogue(
  filters: Filters = parseFilters({}),
): Promise<Catalogue> {
  await connection();
  const mode = catalogueMode();
  if (mode === 'unavailable') return EMPTY_CATALOGUE;
  if (mode === 'fixtures') {
    const data = (await import('./fixtures')).fixtureCatalogue;
    return { ...data, result: filterProducts(data, filters) };
  }
  const params = new URLSearchParams();
  for (const [k, v] of Object.entries(filters)) if (v) params.set(k, String(v));
  const [raw, meta] = await Promise.all([
    publicApi('catalog?' + params),
    metadata(),
  ]);
  const response = record(raw);
  const products = array(response.items).map((p) =>
    parseProduct(p, process.env.QRG_MEDIA_ORIGIN),
  );
  const shops = [...meta.shops];
  for (const p of products)
    if (p.shopDetails && !shops.some((s) => s.slug === p.shop))
      shops.push(p.shopDetails);
  return {
    mode: 'live',
    ...meta,
    shops,
    products,
    result: {
      items: products,
      total: number(response.total),
      pages: number(response.pages),
    },
  };
}
export const getCatalogue = cache(async () => queryCatalogue());
export const readProduct = cache(async (slug: string) => {
  await connection();
  if (catalogueMode() !== 'live') {
    const data = await getCatalogue();
    const product = publicProducts(data).find((p) => p.slug === slug);
    const shop = data.shops.find(
      (s) => s.slug === product?.shop && s.status === 'ACTIVE',
    );
    if (!product || !shop) notFound();
    return { product, shop };
  }
  const raw = await publicApi('products/' + encodeURIComponent(slug));
  if (raw === null) notFound();
  const product = parseProduct(raw, process.env.QRG_MEDIA_ORIGIN);
  const shop = product.shopDetails;
  if (!shop) notFound();
  return { product, shop };
});
export const readShop = cache(async (slug: string) => {
  await connection();
  if (catalogueMode() !== 'live') {
    const data = await getCatalogue();
    const shop = data.shops.find(
      (s) => s.slug === slug && s.status === 'ACTIVE',
    );
    if (!shop) notFound();
    return { shop, data };
  }
  const raw = await publicApi('shops/' + encodeURIComponent(slug));
  if (raw === null) notFound();
  const shop = parseShop(raw);
  const data = await queryCatalogue(parseFilters({ shop: slug }));
  return { shop, data };
});
