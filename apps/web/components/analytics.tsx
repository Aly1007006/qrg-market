'use client';
import { useEffect, useRef } from 'react';
type EventType =
  'SHOP_VIEW' | 'PRODUCT_VIEW' | 'WHATSAPP_CLICK' | 'TWO_GIS_CLICK';
function send(
  type: EventType,
  resource: string,
  slug: string,
  eventId: string,
) {
  if (
    navigator.doNotTrack === '1' ||
    ('globalPrivacyControl' in navigator &&
      navigator.globalPrivacyControl === true)
  )
    return;
  // No cookies, visitor IDs, query strings, phone numbers or third-party analytics.
  void fetch('/api/analytics', {
    method: 'POST',
    credentials: 'omit',
    keepalive: true,
    headers: { 'content-type': 'application/json', 'x-qrg-client': 'web' },
    body: JSON.stringify({ eventId, type, resource, slug }),
  })
    .then((response) => {
      if (!response.ok) console.warn('QRG analytics event unavailable');
    })
    .catch(() => {
      console.warn('QRG analytics transport unavailable');
    });
}
export function AnalyticsView({
  resource,
  slug,
}: {
  resource: 'shop' | 'product';
  slug: string;
}) {
  const sent = useRef('');
  useEffect(() => {
    const key = resource + ':' + slug;
    const record = () => {
      if (document.visibilityState !== 'visible' || sent.current === key)
        return;
      sent.current = key;
      send(
        resource === 'shop' ? 'SHOP_VIEW' : 'PRODUCT_VIEW',
        resource,
        slug,
        crypto.randomUUID(),
      );
    };
    record();
    document.addEventListener('visibilitychange', record);
    return () => document.removeEventListener('visibilitychange', record);
  }, [resource, slug]);
  return null;
}
export function AnalyticsClicks() {
  useEffect(() => {
    const click = (event: MouseEvent) => {
      if (event.type === 'auxclick' && event.button !== 1) return;
      const anchor =
        event.target instanceof Element
          ? event.target.closest('a[data-analytics-event]')
          : null;
      if (!(anchor instanceof HTMLAnchorElement)) return;
      const {
        analyticsEvent: type,
        analyticsResource: resource,
        analyticsSlug: slug,
      } = anchor.dataset;
      if (
        (type === 'WHATSAPP_CLICK' || type === 'TWO_GIS_CLICK') &&
        (resource === 'shop' || resource === 'product') &&
        slug
      )
        send(type, resource, slug, crypto.randomUUID());
    };
    document.addEventListener('click', click);
    document.addEventListener('auxclick', click);
    return () => {
      document.removeEventListener('click', click);
      document.removeEventListener('auxclick', click);
    };
  }, []);
  return null;
}
