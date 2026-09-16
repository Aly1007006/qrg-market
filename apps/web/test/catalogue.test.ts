import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fixtureCatalogue } from '../lib/catalogue/fixtures.ts';
import {
  fixturesEnabled,
  EMPTY_CATALOGUE,
  publicProducts,
  parseFilters,
  filterProducts,
  catalogueUrl,
  money,
  type Catalogue,
} from '../lib/catalogue/model.ts';
import { siteOrigin, pageMetadata } from '../lib/seo.ts';
test('fixtures are opt-in and impossible in production/test/unknown environments', () => {
  assert.equal(fixturesEnabled('development', 'true'), true);
  for (const env of ['production', 'test', '', undefined])
    assert.equal(fixturesEnabled(env, 'true'), false);
  for (const flag of ['false', '1', 'TRUE', undefined])
    assert.equal(fixturesEnabled('development', flag), false);
  assert.deepEqual(EMPTY_CATALOGUE.products, []);
  assert.deepEqual(EMPTY_CATALOGUE.shops, []);
});
test('public products exclude suspended and draft shops even with a matching URL filter', () => {
  // PHASE 7C fixture set includes eight distinct display items; hidden stays excluded.
  assert.equal(publicProducts(fixtureCatalogue).length, 8);
  assert.equal(
    filterProducts(fixtureCatalogue, parseFilters({ shop: 'demo-hidden' }))
      .total,
    0,
  );
  const draft: Catalogue = {
    ...fixtureCatalogue,
    shops: fixtureCatalogue.shops.map((s) => ({ ...s, status: 'DRAFT' })),
  };
  assert.equal(publicProducts(draft).length, 0);
});
test('search covers product, category, brand and shop without case sensitivity', () => {
  for (const q of ['ПАЛЬТО', '  atelier  ', 'Женщинам'])
    assert.equal(
      filterProducts(fixtureCatalogue, parseFilters({ q })).items[0]?.slug,
      'demo-sand-coat',
    );
  assert.equal(
    filterProducts(
      fixtureCatalogue,
      parseFilters({ q: 'несуществующий товар' }),
    ).total,
    0,
  );
});
test('filters combine category, subcategory, brand, mall, shop, size, color and price', () => {
  const query = parseFilters({
    category: 'women',
    subcategory: 'Верхняя одежда',
    brand: 'Atelier · демо',
    shop: 'demo-atelier',
    mall: 'Пример ТЦ · центр',
    size: 'M',
    color: 'Бежевый',
    priceMin: '60000',
    priceMax: '65000',
    availability: 'available',
  });
  assert.equal(filterProducts(fixtureCatalogue, query).total, 1);
  assert.equal(
    filterProducts(fixtureCatalogue, { ...query, size: 'L' }).total,
    0,
  );
  assert.equal(
    filterProducts(fixtureCatalogue, { ...query, color: 'Белый' }).total,
    0,
  );
  assert.equal(
    filterProducts(fixtureCatalogue, { ...query, priceMin: '70000' }).total,
    0,
  );
});
test('all variant constraints must match the same variant', () => {
  const p = fixtureCatalogue.products[0];
  assert.ok(p);
  const data: Catalogue = {
    ...fixtureCatalogue,
    products: [
      {
        ...p,
        variants: [
          { id: '1', size: 'S', color: 'Белый', price: 100, available: true },
          { id: '2', size: 'M', color: 'Чёрный', price: 200, available: false },
        ],
      },
    ],
  };
  assert.equal(
    filterProducts(data, parseFilters({ size: 'M', color: 'Белый' })).total,
    0,
  );
  assert.equal(
    filterProducts(data, parseFilters({ size: 'M', availability: 'available' }))
      .total,
    0,
  );
  assert.equal(
    filterProducts(data, parseFilters({ size: 'S', priceMin: '150' })).total,
    0,
  );
});
test('discounts and sorting use data, not fabricated popularity or ratings', () => {
  assert.equal(
    filterProducts(fixtureCatalogue, parseFilters({ discount: 'true' })).total,
    2,
  );
  assert.equal(
    filterProducts(fixtureCatalogue, parseFilters({ sort: 'price-asc' }))
      .items[0]?.slug,
    'demo-city-sneakers',
  );
  assert.equal(
    filterProducts(fixtureCatalogue, parseFilters({ sort: 'price-desc' }))
      .items[0]?.slug,
    'demo-sand-coat',
  );
  assert.equal(
    filterProducts(fixtureCatalogue, parseFilters({ sort: 'new' })).items[0]
      ?.isNew,
    true,
  );
});
test('untrusted query params are bounded and repeated or invalid values have safe defaults', () => {
  const f = parseFilters({
    q: 'x'.repeat(200),
    page: '-4',
    sort: '<script>',
    priceMin: 'Infinity',
    priceMax: '-10',
    shop: ['demo-atelier', 'demo-form'],
    availability: 'true',
    discount: '1',
    owner_id: 'bad',
  });
  assert.equal(f.q.length, 100);
  assert.equal(f.page, 1);
  assert.equal(f.sort, '');
  assert.equal(f.priceMin, '');
  assert.equal(f.priceMax, '');
  assert.equal(f.shop, '');
  assert.equal(f.availability, '');
  assert.equal(f.discount, '');
  assert.equal(parseFilters({ page: '9999' }).page, 1000);
  assert.equal('owner_id' in f, false);
});
test('URL round trip preserves filters and safely encodes special characters', () => {
  const f = parseFilters({
    q: 'сумка & красота <tag>',
    color: 'Белый',
    discount: 'true',
    page: '2',
  });
  const url = catalogueUrl(f);
  assert.ok(url.startsWith('/catalog?'));
  assert.ok(!url.includes('<tag>'));
  assert.deepEqual(
    parseFilters(
      Object.fromEntries(new URL(url, 'https://example.test').searchParams),
    ),
    f,
  );
  assert.equal(
    new URL(
      catalogueUrl(f, { page: 1 }),
      'https://example.test',
    ).searchParams.has('page'),
    false,
  );
});
test('pagination is bounded, deterministic and does not mutate fixture source', () => {
  const p = fixtureCatalogue.products[0];
  assert.ok(p);
  const data = {
    ...fixtureCatalogue,
    products: Array.from({ length: 19 }, (_, i) => ({
      ...p,
      slug: 'item-' + i,
    })),
  };
  assert.equal(
    filterProducts(data, parseFilters({ page: '1' })).items.length,
    8,
  );
  assert.equal(
    filterProducts(data, parseFilters({ page: '3' })).items.length,
    3,
  );
  assert.equal(
    filterProducts(data, parseFilters({ page: '4' })).items.length,
    0,
  );
  assert.equal(filterProducts(data, parseFilters({ page: '3' })).pages, 3);
  assert.equal(data.products[0]?.slug, 'item-0');
  assert.match(money(10000), /10\s000 ₸/);
});
test('SEO trusts configured HTTPS origin only; preview metadata remains noindex', () => {
  assert.equal(siteOrigin(undefined), undefined);
  assert.equal(
    siteOrigin('https://qrg.example.test'),
    'https://qrg.example.test',
  );
  for (const origin of [
    'http://qrg.test',
    'javascript:alert(1)',
    'https://user:pass@qrg.test',
    'https://qrg.test/path',
    'https://qrg.test/?evil=1',
  ])
    assert.throws(() => siteOrigin(origin));
  assert.deepEqual(pageMetadata('Каталог', 'Описание', '/catalog').robots, {
    index: false,
    follow: false,
  });
});
