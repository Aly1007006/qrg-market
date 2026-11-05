import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  decodeFavorites,
  favoritesUrl,
  parseFavorites,
  toggleFavorite,
} from '../lib/favorites.ts';
test('favorites reject corrupted storage, unsafe slugs and duplicate references', () => {
  assert.deepEqual(decodeFavorites('{bad'), []);
  assert.deepEqual(decodeFavorites('x'.repeat(16001)), []);
  assert.deepEqual(
    parseFavorites([
      { kind: 'product', slug: '../admin' },
      { kind: 'shop', slug: 'https://evil.test' },
      { kind: 'user', slug: 'one' },
      { kind: 'product', slug: 'valid-item' },
      { kind: 'product', slug: 'valid-item' },
    ]),
    [{ kind: 'product', slug: 'valid-item' }],
  );
  assert.equal(
    parseFavorites(
      Array.from({ length: 40 }, (_, i) => ({
        kind: 'shop',
        slug: 'shop-' + i,
      })),
    ).length,
    24,
  );
});
test('favorites toggle without storing price, contact or account data and generate bounded local URLs', () => {
  const item = { kind: 'product', slug: 'coat' } as const;
  const added = toggleFavorite([], item);
  assert.deepEqual(added, [item]);
  assert.deepEqual(toggleFavorite(added, item), []);
  const url = new URL(
    favoritesUrl([{ kind: 'shop', slug: 'atelier' }, item], 999),
    'https://qrg.example',
  );
  assert.equal(url.pathname, '/favorites');
  assert.equal(url.searchParams.get('page'), '3');
  assert.deepEqual([...url.searchParams.keys()], ['product', 'shop', 'page']);
  assert.equal(favoritesUrl([]), '/favorites');
  assert.equal(
    favoritesUrl([{ kind: 'shop', slug: 'atelier' }, item]),
    favoritesUrl([item, { kind: 'shop', slug: 'atelier' }]),
  );
});
