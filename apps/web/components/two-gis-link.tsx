import { safeTwoGis } from '../lib/catalogue/contract';
import { Button } from './ui';
export function TwoGisLink({
  url,
  children = 'Найти в 2GIS',
  analytics,
}: {
  url: string | null | undefined;
  children?: React.ReactNode;
  analytics?: { resource: 'shop' | 'product'; slug: string };
}) {
  const href = safeTwoGis(url);
  return href ? (
    <a
      className="button button-secondary"
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      data-analytics-event={analytics ? 'TWO_GIS_CLICK' : undefined}
      data-analytics-resource={analytics?.resource}
      data-analytics-slug={analytics?.slug}
    >
      {children}
    </a>
  ) : (
    <Button disabled variant="secondary">
      {children}
    </Button>
  );
}
