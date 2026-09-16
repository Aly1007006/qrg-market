import { catalogueMode, publicApi } from '../../../lib/catalogue/repository';
import { parseSuggestions } from '../../../lib/catalogue/suggestions';
import { publicProducts } from '../../../lib/catalogue/model';
export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const q = params.get('q')?.trim() ?? '';
  const headers = { 'Cache-Control': 'no-store' };
  if (params.getAll('q').length > 1 || q.length > 100)
    return Response.json({ error: 'Invalid query' }, { status: 400, headers });
  if (q.length < 2) return Response.json([], { headers });
  try {
    if (catalogueMode() === 'unavailable')
      return Response.json([], { headers });
    if (catalogueMode() === 'fixtures') {
      const data = (await import('../../../lib/catalogue/fixtures'))
        .fixtureCatalogue;
      return Response.json(
        publicProducts(data)
          .filter((p) =>
            (p.name + ' ' + p.brand)
              .toLocaleLowerCase('ru')
              .includes(q.toLocaleLowerCase('ru')),
          )
          .slice(0, 8)
          .map((p) => ({ slug: p.slug, name: p.name })),
        { headers },
      );
    }
    return Response.json(
      parseSuggestions(
        await publicApi('search/suggestions?q=' + encodeURIComponent(q)),
      ),
      { headers },
    );
  } catch {
    return Response.json(
      { error: 'Search temporarily unavailable' },
      { status: 503, headers },
    );
  }
}
