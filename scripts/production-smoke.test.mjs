import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { createRequire } from 'node:module';
import { test } from 'node:test';
import assert from 'node:assert/strict';

const webRequire = createRequire(
  new URL('../apps/web/package.json', import.meta.url),
);
async function waitFor(url, child) {
  for (let i = 0; i < 100; i++) {
    if (child.exitCode !== null)
      throw new Error(`Server exited with ${child.exitCode}`);
    try {
      return await fetch(url);
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  }
  throw new Error('Server readiness timeout');
}
async function stop(child) {
  if (child.exitCode === null) {
    const exited = once(child, 'exit');
    child.kill();
    await exited;
  }
}
test('production Next.js serves public shell without fixtures and preserves security/SEO gates', async () => {
  const server = spawn(
    process.execPath,
    [
      webRequire.resolve('next/dist/bin/next'),
      'start',
      '-p',
      '43180',
      '-H',
      '127.0.0.1',
    ],
    {
      cwd: new URL('../apps/web/', import.meta.url),
      stdio: 'pipe',
      env: {
        ...process.env,
        NODE_ENV: 'production',
        NEXT_TELEMETRY_DISABLED: '1',
        QRG_DEV_FIXTURES: 'true',
        QRG_API_ORIGIN: '',
        QRG_SITE_URL: 'https://qrg.example.test',
      },
    },
  );
  try {
    const response = await waitFor('http://127.0.0.1:43180', server);
    assert.equal(response.status, 200);
    const html = await response.text();
    assert.match(html, /<html lang="ru"/);
    assert.match(html, /Все бутики Караганды/);
    assert.match(html, /в одном месте/);
    assert.match(html, /Реальные предложения магазинов пока не подключены/);
    assert.ok(!html.includes('demo-sand-coat'));
    assert.ok(!html.includes('/dev-fixtures/'));
    assert.match(html, /noindex/);
    assert.equal(response.headers.get('x-content-type-options'), 'nosniff');
    assert.equal(response.headers.get('x-powered-by'), null);
    assert.match(html, /rel="canonical" href="https:\/\/qrg\.example\.test\/"/);
    const catalog = await fetch('http://127.0.0.1:43180/catalog');
    assert.equal(catalog.status, 200);
    assert.match(await catalog.text(), /Каталог готовится к открытию/);
    for (const path of ['/product/demo-sand-coat', '/shop/demo-atelier']) {
      const missing = await fetch('http://127.0.0.1:43180' + path, {
        headers: { 'user-agent': 'Googlebot' },
      });
      assert.equal(missing.status, 404);
    }
    assert.match(
      await (await fetch('http://127.0.0.1:43180/robots.txt')).text(),
      /Disallow: \//,
    );
    assert.ok(
      !(
        await (await fetch('http://127.0.0.1:43180/sitemap.xml')).text()
      ).includes('demo-'),
    );
  } finally {
    await stop(server);
  }
});
test('compiled production API boots, serves health and hides Swagger', async () => {
  const server = spawn(process.execPath, ['apps/api/dist/main.js'], {
    cwd: new URL('../', import.meta.url),
    stdio: 'pipe',
    env: {
      ...process.env,
      NODE_ENV: 'production',
      PORT: '43181',
      DATABASE_URL: 'postgresql://test:local-only@127.0.0.1:1/unavailable',
      DATABASE_SSL: 'true',
      SWAGGER_ENABLED: 'false',
      APP_ORIGIN: 'https://qrg.example',
      AUTH_RATE_LIMIT_SECRET: 'test-rate-limit-secret-at-least-32-characters',
    },
  });
  try {
    const response = await waitFor(
      'http://127.0.0.1:43181/api/v1/health',
      server,
    );
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { status: 'ok' });
    assert.equal((await fetch('http://127.0.0.1:43181/api/docs')).status, 404);
    assert.equal(
      (await fetch('http://127.0.0.1:43181/api/v1/health/ready')).status,
      503,
    );
  } finally {
    await stop(server);
  }
});
