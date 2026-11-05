import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { once } from 'node:events';
import {
  allowedPreviewPath,
  previewGateway,
} from './public-preview-gateway.mjs';

test('preview allowlist excludes private routes, development endpoints, traversal and image SSRF', () => {
  for (const path of [
    '/',
    '/catalog?q=coat',
    '/product/demo-sand-coat',
    '/shop/demo-atelier',
    '/api/search?q=coat',
    '/_next/static/chunks/page.js',
    '/_next/image?url=%2Fdev-fixtures%2Fcoat.jpg&w=640&q=75',
  ])
    assert.equal(allowedPreviewPath(path), true, path);
  for (const path of [
    '/seller',
    '/seller/login',
    '/admin',
    '/api/seller/me',
    '/api/requests',
    '/api/analytics',
    '/api/images/id',
    '/api/admin/logs',
    '/.env',
    '/__nextjs_original-stack-frames',
    '/_next/webpack-hmr',
    '/_next/static/chunks/page.js.map',
    '/catalog/../seller',
    '/%73eller',
    '/%252eseller',
    '//example.com',
    '/_next/image?url=http://api:3001',
    '/_next/image?url=%2Fapi%2Fimages%2Fid',
    '/_next/image?url=/brand/market-hero.png&url=/api/images/id',
  ])
    assert.equal(allowedPreviewPath(path), false, path);
});

test('gateway strips credentials, cookies and route overrides and rejects writes before upstream', async () => {
  let calls = 0;
  const upstream = createServer((req, res) => {
    calls++;
    assert.equal(req.headers.cookie, undefined);
    assert.equal(req.headers.authorization, undefined);
    assert.equal(req.headers['x-middleware-subrequest'], undefined);
    res.setHeader('Set-Cookie', 'never-forward=1');
    res.end('fixture-only');
  }).listen(0, '127.0.0.1');
  await once(upstream, 'listening');
  const gateway = previewGateway(upstream.address().port).listen(
    0,
    '127.0.0.1',
  );
  await once(gateway, 'listening');
  const base = `http://127.0.0.1:${gateway.address().port}`;
  try {
    const result = await fetch(base + '/', {
      headers: {
        cookie: 'qrg_session=private',
        authorization: 'Bearer private',
        'x-middleware-subrequest': 'proxy',
      },
    });
    assert.equal(await result.text(), 'fixture-only');
    assert.equal(result.headers.get('set-cookie'), null);
    assert.equal(result.headers.get('x-robots-tag'), 'noindex, nofollow');
    for (const method of ['POST', 'PUT', 'PATCH', 'DELETE'])
      assert.equal(
        (await fetch(base + '/', { method, body: 'blocked' })).status,
        403,
      );
    assert.equal((await fetch(base + '/api/requests')).status, 403);
    assert.equal(calls, 1);
    assert.match(
      await (await fetch(base + '/robots.txt')).text(),
      /Disallow: \//,
    );
  } finally {
    await Promise.all([
      new Promise((resolve) => gateway.close(resolve)),
      new Promise((resolve) => upstream.close(resolve)),
    ]);
  }
});
