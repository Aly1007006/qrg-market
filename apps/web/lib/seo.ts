import type { Metadata } from 'next';
export function indexingEnabled() {
  return (
    process.env.NODE_ENV === 'production' &&
    process.env.QRG_INDEXING_ENABLED === 'true' &&
    !!process.env.QRG_API_ORIGIN &&
    !!siteOrigin(process.env.QRG_SITE_URL)
  );
}
export function siteOrigin(value: string | undefined) {
  if (!value) return undefined;
  const url = new URL(value);
  if (
    url.protocol !== 'https:' ||
    url.username ||
    url.password ||
    url.pathname !== '/' ||
    url.search ||
    url.hash
  )
    throw new Error('QRG_SITE_URL must be a trusted HTTPS origin');
  return url.origin;
}
export function pageMetadata(
  title: string,
  description: string,
  path: string,
  image?: string,
): Metadata {
  const origin = siteOrigin(process.env.QRG_SITE_URL);
  return {
    title,
    description,
    robots: { index: indexingEnabled(), follow: indexingEnabled() },
    ...(origin ? { alternates: { canonical: origin + path } } : {}),
    openGraph: {
      title: title + ' · QRG MARKET',
      description,
      locale: 'ru_KZ',
      type: 'website',
      ...(origin && image
        ? { images: [{ url: new URL(image, origin).href, alt: title }] }
        : {}),
      ...(origin ? { url: origin + path } : {}),
    },
  };
}
export function jsonLd(value: unknown) {
  return JSON.stringify(value).replace(/</g, '\\u003c');
}
