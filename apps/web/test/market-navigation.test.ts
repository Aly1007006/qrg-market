import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import { departmentLinks } from '../lib/market-navigation.ts';

test('reference departments preserve order and use search when taxonomy is unavailable', () => {
  const links = departmentLinks([]);
  assert.equal(links.length, 7);
  assert.equal(links[0]?.name, 'Женская одежда');
  assert.equal(links[6]?.name, 'Косметика');
  for (const removed of ['Детские товары', 'Для дома', 'Спорт', 'Ещё']) {
    assert.ok(!links.some((link) => link.name === removed));
  }
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

test('compact public controls keep a 44px touch target at mobile widths', () => {
  const css = readFileSync('components/market.module.css', 'utf8');
  for (const selector of [
    '.topActions a',
    '.headerActions a,',
    '.categoryNav a',
    '.headerSearchStyle :global(.search input)',
    '.searchWrap :global(.search .button)',
    '.sectionHeading > a',
    '.shopIdentity > div > a',
    '.shopButtons :global(.button)',
    '.footerBrand',
    '.footer nav a',
    '.mobileMenu :global(.button)',
  ]) {
    const start = css.indexOf(selector);
    assert.ok(start >= 0, selector);
    assert.match(css.slice(start, start + 260), /min-height:\s*44px/);
  }
  const globalCss = readFileSync('app/globals.css', 'utf8');
  for (const selector of [
    '.breadcrumbs a',
    '.category-pills a',
    '.text-link',
    '.search input',
  ]) {
    const start = globalCss.indexOf(selector);
    assert.ok(start >= 0, selector);
    assert.match(globalCss.slice(start, start + 260), /min-height:\s*44px/);
  }
});
