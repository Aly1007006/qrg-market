import 'reflect-metadata';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { normalizeTwoGis, normalizePhone } from '../src/catalogue/two-gis.js';
import { CatalogQueryDto, ProductCreateDto } from '../src/catalogue/dto.js';
const link = 'https://2gis.kz/karaganda/firm/70000001038483747';
await test('2GIS canonical HTTPS firm URL and optional matching id', () => {
  assert.deepEqual(normalizeTwoGis(link + '/'), {
    twoGisUrl: link,
    twoGisFirmId: '70000001038483747',
  });
  assert.deepEqual(normalizeTwoGis(null), {
    twoGisUrl: null,
    twoGisFirmId: null,
  });
  assert.throws(() => normalizeTwoGis(link, '70000001000000000'));
  assert.throws(() => normalizeTwoGis(null, '70000001000000000'));
});
await test('2GIS rejects URL parser tricks, redirects and unapproved domains/formats', () => {
  for (const malicious of [
    'http://2gis.kz/karaganda/firm/70000001038483747',
    'https://2gis.kz.evil.test/karaganda/firm/70000001038483747',
    'https://evil.test@2gis.kz/karaganda/firm/70000001038483747',
    'https://2gis.kz@evil.test/karaganda/firm/70000001038483747',
    'https://2gis.kz:443/karaganda/firm/70000001038483747',
    'https://2gis.kz./karaganda/firm/70000001038483747',
    'https://2gіs.kz/karaganda/firm/70000001038483747',
    'https://2gis.ru/karaganda/firm/70000001038483747',
    'https://go.2gis.com/test',
    '//2gis.kz/karaganda/firm/70000001038483747',
    'javascript:alert(1)',
    'data:text/html,test',
    'file:///etc/passwd',
    link + '?next=https://evil.test',
    link + '#redirect',
    link + '/tab/info',
    link + '/../other',
    link + '%0a',
    link + '%252f',
    link + '\\evil.test',
    ' ' + link,
    link + '\n',
    link.replace('2gis', '%32gis'),
    link.replace('/firm/', '/%66irm/'),
    link.replace('/firm/', '//firm/'),
  ])
    assert.throws(() => normalizeTwoGis(malicious), malicious);
});
await test('phone normalization does not accept letters or HTML', () => {
  assert.equal(normalizePhone('+7 (701) 234-56-78'), '+77012345678');
  for (const value of ['77012345678', '+0123456789', '<script>', '+7CALLME'])
    assert.throws(() => normalizePhone(value));
});
await test('catalog validation bounds paging, prices and sort; unknown ownership fields rejected', async () => {
  for (const value of [
    { page: 0 },
    { limit: 101 },
    { page: 1.5 },
    { q: 'a'.repeat(101) },
    { sort: 'random()' },
    { priceMin: '1e9' },
    { priceMax: 'NaN' },
  ]) {
    assert.ok(
      (await validate(plainToInstance(CatalogQueryDto, value))).length > 0,
    );
  }
  const good = {
    name: 'Товар',
    slug: 'test-product',
    categoryId: '96612049-4b75-4d96-bf6e-eefbcdbe8e49',
    basePrice: 100.25,
  };
  assert.equal(
    (await validate(plainToInstance(ProductCreateDto, good))).length,
    0,
  );
  assert.ok(
    (
      await validate(
        plainToInstance(ProductCreateDto, {
          ...good,
          shop_id: 'attacker',
          role: 'SHOP_OWNER',
        }),
        { whitelist: true, forbidNonWhitelisted: true },
      )
    ).length > 0,
  );
});
