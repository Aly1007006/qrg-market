import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseProduct, safeTwoGis } from '../lib/catalogue/contract.ts';
import {
  nextSuggestion,
  parseSuggestions,
} from '../lib/catalogue/suggestions.ts';
import { parseFilters, catalogueUrl } from '../lib/catalogue/model.ts';
await test('autocomplete bounded contract and keyboard wraparound', () => {
  assert.equal(nextSuggestion(-1, 'ArrowDown', 3), 0);
  assert.equal(nextSuggestion(2, 'ArrowDown', 3), 0);
  assert.equal(nextSuggestion(-1, 'ArrowUp', 3), 2);
  assert.equal(nextSuggestion(0, 'ArrowDown', 0), -1);
  assert.deepEqual(
    parseSuggestions([{ slug: 'real-product', name: 'Товар' }]),
    [{ slug: 'real-product', name: 'Товар' }],
  );
  for (const value of [
    [{ slug: 'javascript:alert(1)', name: 'bad' }],
    Array(9).fill({ slug: 'x', name: 'x' }),
    null,
  ])
    assert.throws(() => parseSuggestions(value));
});
await test('live API prices, variants, safe images and 2GIS links', () => {
  const shop = {
    slug: 'real-shop',
    name: 'Бутик',
    description: '',
    category: '',
    mall: '',
    address: 'Адрес',
    status: 'ACTIVE',
    twoGisUrl: 'https://evil.test',
  };
  const raw = {
    slug: 'real-product',
    name: 'Товар',
    description: '',
    category: 'women',
    subcategory: '',
    brand: '',
    shop: shop.slug,
    shopDetails: shop,
    price: 99.25,
    oldPrice: null,
    isNew: true,
    imageAlt: 'Товар',
    imageKey: 'https://evil.test/x.svg',
    variants: [{ id: 'v', size: '', color: '', available: true, price: 99.25 }],
  };
  const result = parseProduct(raw, 'https://media.example.test');
  assert.equal(result.image, '');
  assert.equal(result.demo, false);
  assert.equal(result.oldPrice, undefined);
  assert.equal(result.shopDetails?.twoGisUrl, null);
  assert.throws(() => parseProduct({ ...raw, price: '99' }));
  assert.throws(() =>
    parseProduct({ ...raw, shopDetails: { ...shop, status: 'SUSPENDED' } }),
  );
  assert.equal(
    safeTwoGis('https://2gis.kz/karaganda/firm/70000001038483747'),
    'https://2gis.kz/karaganda/firm/70000001038483747',
  );
});
await test('URL keeps decimal prices and encodes all query values', () => {
  const filters = parseFilters({
    priceMin: '100.25',
    q: 'Товар & размер',
    size: 'M',
    mall: 'ТЦ & Город',
  });
  assert.equal(filters.priceMin, '100.25');
  const url = new URL(catalogueUrl(filters), 'http://localhost');
  assert.equal(url.searchParams.get('q'), 'Товар & размер');
  assert.equal(url.searchParams.get('mall'), 'ТЦ & Город');
});
