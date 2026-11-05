export type Favorite = { kind: 'product' | 'shop'; slug: string };
export type FavoriteScope = 'demo' | 'live';
export const FAVORITES_LIMIT = 24;
export const FAVORITES_PAGE_SIZE = 8;
export function parseFavorites(value: unknown): Favorite[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  const result: Favorite[] = [];
  for (const item of value.slice(0, 100)) {
    if (!item || typeof item !== 'object') continue;
    const entry = item as Record<string, unknown>;
    if (
      (entry.kind !== 'product' && entry.kind !== 'shop') ||
      typeof entry.slug !== 'string' ||
      entry.slug.length > 120 ||
      !/^[a-z0-9]+(-[a-z0-9]+)*$/.test(entry.slug)
    )
      continue;
    const key = entry.kind + ':' + entry.slug;
    if (seen.has(key)) continue;
    seen.add(key);
    result.push({ kind: entry.kind, slug: entry.slug });
    if (result.length === FAVORITES_LIMIT) break;
  }
  return result;
}
export function decodeFavorites(raw: string): Favorite[] {
  if (raw.length > 16000) return [];
  try {
    return parseFavorites(JSON.parse(raw));
  } catch {
    return [];
  }
}
export function toggleFavorite(items: Favorite[], item: Favorite) {
  const valid = parseFavorites([item])[0];
  if (!valid) return parseFavorites(items);
  const current = parseFavorites(items);
  return current.some(
    (entry) => entry.kind === valid.kind && entry.slug === valid.slug,
  )
    ? current.filter(
        (entry) => entry.kind !== valid.kind || entry.slug !== valid.slug,
      )
    : [valid, ...current].slice(0, FAVORITES_LIMIT);
}
export function favoritesUrl(items: Favorite[], page = 1) {
  const query = new URLSearchParams();
  const valid = parseFavorites(items);
  for (const kind of ['product', 'shop'] as const)
    for (const item of valid.filter((entry) => entry.kind === kind))
      query.append(item.kind, item.slug);
  if (page > 1) query.set('page', String(Math.min(3, Math.floor(page))));
  return '/favorites' + (query.size ? '?' + query : '');
}
