// Validate the public API boundary; no arbitrary media URLs or untrusted HTML.
import type { Product, Shop } from './model.ts';
export function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new Error('Invalid catalog response');
  return value as Record<string, unknown>;
}
export function string(value: unknown): string {
  if (typeof value !== 'string') throw new Error('Invalid catalog text');
  return value;
}
export function array(value: unknown): unknown[] {
  if (!Array.isArray(value)) throw new Error('Invalid catalog list');
  return value;
}
export function number(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0)
    throw new Error('Invalid catalog number');
  return value;
}
export function safeTwoGis(value: unknown): string | null {
  return typeof value === 'string' &&
    /^https:\/\/2gis[.]kz\/karaganda\/firm\/[0-9]{10,20}$/.test(value)
    ? value
    : null;
}
export function parseShop(value: unknown): Shop {
  const s = record(value);
  if (s.status !== 'ACTIVE') throw new Error('Non-public shop');
  const slug = string(s.slug);
  if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(slug)) throw new Error('Invalid slug');
  return {
    slug,
    name: string(s.name),
    description: string(s.description),
    image: imageProxy(s.imageId),
    logo: imageProxy(s.logoId),
    category: string(s.category),
    mall: string(s.mall),
    status: 'ACTIVE',
    address: string(s.address),
    twoGisUrl: safeTwoGis(s.twoGisUrl),
    whatsappPhone:
      typeof s.whatsappPhone === 'string' &&
      /^\+[1-9][0-9]{7,14}$/.test(s.whatsappPhone)
        ? s.whatsappPhone
        : null,
    demo: false,
  };
}
export function mediaUrl(key: unknown, mediaOrigin?: string): string {
  let image = '';
  if (
    mediaOrigin &&
    typeof key === 'string' &&
    /^products\/[0-9a-f-]{36}\/[0-9a-f-]{36}[.](webp|avif)$/.test(key)
  ) {
    const origin = new URL(mediaOrigin);
    if (
      origin.protocol !== 'https:' ||
      origin.username ||
      origin.password ||
      origin.pathname !== '/' ||
      origin.search ||
      origin.hash
    )
      throw new Error('Invalid media origin');
    image = origin.origin + '/' + key;
  }
  return image;
}
export function parseProduct(value: unknown, mediaOrigin?: string): Product {
  const p = record(value);
  const slug = string(p.slug);
  if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(slug)) throw new Error('Invalid slug');
  const image = imageProxy(p.imageId) || mediaUrl(p.imageKey, mediaOrigin);
  return {
    ...(typeof p.id === 'string' ? { id: p.id } : {}),
    slug,
    name: string(p.name),
    description: string(p.description),
    category: string(p.category),
    subcategory: string(p.subcategory),
    brand: string(p.brand),
    shop: string(p.shop),
    image,
    imageAlt: string(p.imageAlt),
    price: number(p.price),
    ...(p.oldPrice == null ? {} : { oldPrice: number(p.oldPrice) }),
    isNew: p.isNew === true,
    demo: false,
    shopDetails: parseShop(p.shopDetails),
    images: array(p.images ?? [])
      .map((item) => {
        const i = record(item);
        return {
          url: imageProxy(i.id) || mediaUrl(i.objectKey, mediaOrigin),
          alt: string(i.alt),
        };
      })
      .filter((i) => i.url),
    variants: array(p.variants).map((item) => {
      const v = record(item);
      if (typeof v.available !== 'boolean')
        throw new Error('Invalid availability');
      return {
        id: string(v.id),
        size: string(v.size),
        color: string(v.color),
        price: number(v.price),
        available: v.available,
      };
    }),
  };
}
function imageProxy(id: unknown): string {
  return typeof id === 'string' &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(
      id,
    )
    ? '/api/images/' + id
    : '';
}
