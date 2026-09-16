export interface Suggestion {
  slug: string;
  name: string;
}
export function parseSuggestions(value: unknown): Suggestion[] {
  if (!Array.isArray(value) || value.length > 8)
    throw new Error('Invalid suggestions');
  return value.map((v: unknown) => {
    if (
      !v ||
      typeof v !== 'object' ||
      !('slug' in v) ||
      !('name' in v) ||
      typeof v.slug !== 'string' ||
      typeof v.name !== 'string' ||
      v.name.length > 200 ||
      !/^[a-z0-9]+(-[a-z0-9]+)*$/.test(v.slug)
    )
      throw new Error('Invalid suggestion');
    return { slug: v.slug, name: v.name };
  });
}
export function nextSuggestion(
  current: number,
  key: string,
  count: number,
): number {
  if (!count) return -1;
  if (key === 'ArrowDown') return (current + 1) % count;
  if (key === 'ArrowUp') return current <= 0 ? count - 1 : current - 1;
  return current;
}
