import assert from 'node:assert/strict';
import { test } from 'node:test';
import { departmentLinks } from '../lib/market-navigation.ts';

test('reference departments preserve order and use search when taxonomy is unavailable', () => {
  const links = departmentLinks([]);
  assert.equal(links.length, 10);
  assert.equal(links[0]?.name, 'Женская одежда');
  assert.equal(links[9]?.name, 'Спорт');
  for (const link of links) {
    const url = new URL(link.href, 'https://qrg.example');
    assert.equal(url.pathname, '/catalog');
    assert.ok(url.searchParams.get('q'));
    assert.equal(url.searchParams.has('category'), false);
  }
});

test('department links use existing taxonomy without mutating it or injecting URL parameters', () => {
  const categories = Object.freeze([
    { slug: 'women', name: 'Женщинам', note: '' },
    { slug: 'custom&shop=other#x', name: 'Косметика', note: '' },
  ]);
  const links = departmentLinks(categories);
  assert.equal(links[0]?.href, '/catalog?category=women');
  const cosmetics = new URL(links[6]!.href, 'https://qrg.example');
  assert.equal(cosmetics.searchParams.get('category'), 'custom&shop=other#x');
  assert.equal(cosmetics.searchParams.has('shop'), false);
  assert.equal(cosmetics.hash, '');
  assert.equal(categories.length, 2);
});
