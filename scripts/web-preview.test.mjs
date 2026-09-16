import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { createRequire } from 'node:module';
import { before, after, test } from 'node:test';
import assert from 'node:assert/strict';
const webRequire = createRequire(
  new URL('../apps/web/package.json', import.meta.url),
);
const reuse = process.env.QRG_PREVIEW_TEST_URL;
if (reuse && reuse !== 'http://127.0.0.1:3002')
  throw new Error('Only the explicitly configured local preview can be reused');
const base = reuse ?? 'http://127.0.0.1:43182';
let server;
before(async () => {
  if (!reuse)
    server = spawn(
      process.execPath,
      [
        webRequire.resolve('next/dist/bin/next'),
        'dev',
        '-p',
        '43182',
        '-H',
        '127.0.0.1',
      ],
      {
        cwd: new URL('../apps/web/', import.meta.url),
        stdio: 'pipe',
        env: {
          ...process.env,
          NODE_ENV: 'development',
          QRG_DEV_FIXTURES: 'true',
          NEXT_TELEMETRY_DISABLED: '1',
        },
      },
    );
  for (let i = 0; i < 150; i++) {
    if (server?.exitCode !== null && server?.exitCode !== undefined)
      throw new Error('Preview server exited');
    try {
      const response = await fetch(base);
      if (response.ok) return;
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  throw new Error('Preview readiness timeout');
});
after(async () => {
  if (server && server.exitCode === null) {
    const exited = once(server, 'exit');
    server.kill();
    await exited;
  }
});
const html = async (path) => {
  const response = await fetch(base + path);
  assert.equal(response.status, 200);
  return response.text();
};
test('fixture home is SSR, explicitly labelled and contains every requested section', async () => {
  const text = await html('/');
  for (const word of [
    'Все бутики Караганды',
    'в одном месте',
    'Популярные бутики',
    'Популярные товары',
    'Новые поступления',
    'Находки со скидкой',
    'Как работает QRG',
    'Демонстрационный режим',
  ])
    assert.ok(text.includes(word), word);
  assert.match(text, /name="robots" content="noindex, nofollow"/);
  assert.ok(text.includes('/product/demo-sand-coat'));
  assert.ok(!text.includes('Непубличный товар'));
  assert.ok(!text.includes('aggregateRating'));
  assert.ok(!text.includes('application/ld+json'));
});
test('catalogue applies search, category, price, sale and empty states on server', async () => {
  assert.ok(
    (await html('/catalog?q=' + encodeURIComponent('пальто'))).includes(
      'Демо-товаров найдено: 1',
    ),
  );
  assert.ok(
    (await html('/catalog?category=beauty')).includes('Парфюмерная вода'),
  );
  assert.ok(
    (await html('/catalog?discount=true')).includes('Демо-товаров найдено: 2'),
  );
  assert.ok(
    (await html('/catalog?priceMax=1000')).includes('Ничего не нашлось'),
  );
  assert.ok(
    (await html('/catalog?shop=demo-hidden')).includes('Ничего не нашлось'),
  );
});
test('URL-controlled content is escaped and filters have labelled native controls', async () => {
  const text = await html(
    '/catalog?q=' + encodeURIComponent('<img src=x onerror=alert(1)>'),
  );
  assert.ok(!text.includes('<img src=x onerror=alert(1)>'));
  assert.ok(text.includes('&lt;img'));
  for (const name of [
    'category',
    'subcategory',
    'brand',
    'size',
    'color',
    'priceMin',
    'priceMax',
    'shop',
    'mall',
    'availability',
    'discount',
  ])
    assert.ok(text.includes('name="' + name + '"'), name);
  assert.match(text, /<dialog[^>]+aria-labelledby=/);
  assert.match(text, /aria-haspopup="dialog"/);
  assert.ok(text.includes('Применить фильтры'));
});
test('product SSR exposes variants and direct-payment disclaimer without actionable fake contacts', async () => {
  const text = await html('/product/demo-sand-coat');
  assert.ok(text.includes('Пальто свободного кроя'));
  assert.ok(text.includes('QRG MARKET не принимает оплату за данный товар.'));
  assert.ok(text.includes('id="product-variant"'));
  assert.ok(text.includes('нет в наличии'));
  assert.match(text, /<button[^>]*disabled=""/);
  assert.ok(!text.includes('https://wa.me'));
  assert.ok(!text.includes('href="https://2gis'));
  assert.ok(text.includes('Демонстрационный товар'));
});
test('shop SSR displays catalogue and clearly unverified demo identity', async () => {
  const text = await html('/shop/demo-atelier');
  for (const word of [
    'Демо-магазин · не верифицирован',
    'Товары бутика',
    'Новое в магазине',
    'Акции',
    'Будет указан после проверки',
  ])
    assert.ok(text.includes(word), word);
  assert.ok(text.includes('/product/demo-sand-coat'));
  assert.ok(!text.includes('/product/demo-city-sneakers'));
});
test('unknown and inactive product/shop pages are not publicly disclosed', async () => {
  for (const path of [
    '/shop/demo-hidden',
    '/product/demo-hidden-product',
    '/product/missing',
    '/shop/missing',
  ]) {
    const response = await fetch(base + path, {
      headers: { 'user-agent': 'Googlebot' },
    });
    const text = await response.text();
    assert.equal(response.status, 404, path);
    assert.ok(text.includes('не удалось найти'));
  }
});
test('all local photos decode through Next image optimization; no third-party runtime images', async () => {
  for (const name of ['interior', 'coat', 'bag', 'shoes', 'perfume']) {
    const response = await fetch(
      base +
        '/_next/image?url=' +
        encodeURIComponent('/dev-fixtures/' + name + '.jpg') +
        '&w=640&q=75',
    );
    assert.equal(response.status, 200, name);
    assert.match(response.headers.get('content-type') ?? '', /^image\//);
    assert.ok((await response.arrayBuffer()).byteLength > 1000);
  }
  const text = await html('/');
  assert.ok(!text.includes('src="https://images.'));
});
test('robots and sitemap never advertise fixture records', async () => {
  assert.ok((await html('/robots.txt')).includes('Disallow: /'));
  const map = await html('/sitemap.xml');
  assert.ok(!map.includes('demo-'));
  assert.ok(!map.includes('<loc>'));
});

test('reference shell preserves search forms, safe navigation and honest card metadata', async () => {
  const text = await html('/');
  assert.ok(!text.includes('Не удалось загрузить страницу'));
  for (const id of ['header-search', 'hero-search'])
    assert.ok(text.includes('id="' + id + '"'));
  assert.equal((text.match(/action="\/catalog"/g) ?? []).length, 2);
  for (const label of [
    'Для покупателей — бесплатно',
    'Разместить бутик',
    'Избранное пока недоступно',
    'Режим работы пока не указан',
  ])
    assert.ok(text.includes(label), label);
  assert.ok(text.includes('href="/seller/login"'));
  assert.ok(text.includes('href="/product/demo-kids-set"'));
  assert.ok(text.includes('href="/shop/demo-beauty"'));
  assert.ok(text.includes('<details'));
  assert.ok(!text.includes('aggregateRating'));
});

test('reference assets optimize while protected image proxy cannot be cached through optimizer', async () => {
  for (const path of [
    '/brand/market-hero.png',
    '/brand/category-objects.png',
    '/dev-fixtures/boutique-men.png',
    '/dev-fixtures/boutique-bags.png',
    '/dev-fixtures/boutique-beauty.png',
    '/dev-fixtures/hoodie.png',
    '/dev-fixtures/watch.png',
    '/dev-fixtures/dress.png',
    '/dev-fixtures/kids.png',
  ]) {
    const response = await fetch(
      base + '/_next/image?url=' + encodeURIComponent(path) + '&w=640&q=75',
    );
    assert.equal(response.status, 200, path);
    assert.match(response.headers.get('content-type') ?? '', /^image\//);
    assert.ok((await response.arrayBuffer()).byteLength > 1000);
  }
  const response = await fetch(
    base + '/_next/image?url=%2Fapi%2Fimages%2Fprivate&w=640&q=75',
  );
  assert.equal(response.status, 400);
});
