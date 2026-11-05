import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { indexingEnabled, jsonLd, pageMetadata } from '../lib/seo.ts';
import { allowedSellerRoute } from '../lib/seller/boundary.ts';
import {
  contentSecurityPolicy,
  strictTransportSecurity,
  validRequestNonce,
} from '../lib/security-headers.ts';

test('production CSP uses a request nonce and HSTS stays behind verified HTTPS configuration', () => {
  const nonce = Buffer.from('fixed-test-nonce-value').toString('base64');
  const csp = contentSecurityPolicy(
    nonce,
    'production',
    'https://media.qrg.example.test',
  );
  for (const directive of [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'`,
    "style-src 'self' 'nonce-",
    'img-src',
    'font-src',
    'connect-src',
    "frame-ancestors 'none'",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
  ])
    assert.ok(csp.includes(directive), directive);
  assert.ok(csp.includes('https://media.qrg.example.test'));
  assert.ok(!csp.includes("'unsafe-eval'"));
  assert.ok(!csp.includes(' *'));
  assert.equal(validRequestNonce(nonce), nonce);
  assert.equal(validRequestNonce("bad'; script-src *"), undefined);
  assert.equal(
    strictTransportSecurity('production', 'true', 'https://qrg.example.test'),
    'max-age=31536000',
  );
  assert.equal(
    strictTransportSecurity('production', 'false', 'https://qrg.example.test'),
    null,
  );
  assert.throws(() =>
    strictTransportSecurity('production', 'true', 'http://qrg.example.test'),
  );
});

test('indexing requires explicit production launch, trusted HTTPS origin and live API', () => {
  const keys = [
    'NODE_ENV',
    'QRG_INDEXING_ENABLED',
    'QRG_SITE_URL',
    'QRG_API_ORIGIN',
  ] as const;
  const previous = keys.map((key) => process.env[key]);
  try {
    Object.assign(process.env, {
      NODE_ENV: 'production',
      QRG_INDEXING_ENABLED: 'true',
      QRG_SITE_URL: 'https://qrg.example.test',
      QRG_API_ORIGIN: 'http://localhost:3001',
    });
    assert.equal(indexingEnabled(), true);
    assert.deepEqual(
      pageMetadata('Product', 'Description', '/product/one').robots,
      { index: true, follow: true },
    );
    for (const key of keys) {
      const value = process.env[key];
      delete process.env[key];
      assert.equal(indexingEnabled(), false);
      Object.assign(process.env, { [key]: value });
    }
  } finally {
    keys.forEach((key, i) => {
      if (previous[i] === undefined) delete process.env[key];
      else Object.assign(process.env, { [key]: previous[i] });
    });
  }
});
test('structured data cannot escape its script and preserves source text without fake ratings', () => {
  const value = {
    name: '</script><script>alert(1)</script>',
    description: 'Пример',
  };
  const serialized = jsonLd(value);
  assert.ok(!serialized.includes('<'));
  assert.deepEqual(JSON.parse(serialized), value);
});
test('analytics client is cookieless, respects privacy signals and does not block navigation', () => {
  const source = readFileSync('components/analytics.tsx', 'utf8');
  assert.match(source, /credentials: 'omit'/);
  assert.match(source, /globalPrivacyControl/);
  assert.match(source, /doNotTrack/);
  assert.match(source, /visibilityState/);
  assert.doesNotMatch(
    source,
    /localStorage|sessionStorage|document\.cookie|preventDefault|phone:/,
  );
  assert.match(source, /JSON.stringify\(\{ eventId, type, resource, slug \}\)/);
});
test('private layouts remain noindex independently of public launch configuration', () => {
  for (const area of ['seller', 'admin'])
    assert.match(
      readFileSync(`app/${area}/layout.tsx`, 'utf8'),
      /index: false, follow: false/,
    );
});
test('seller analytics proxy exposes a read-only tenant-scoped route', () => {
  const path = 'shops/12345678-1234-4123-8123-123456789abc/analytics';
  assert.equal(allowedSellerRoute(path, 'GET'), true);
  for (const method of ['POST', 'PATCH', 'DELETE'])
    assert.equal(allowedSellerRoute(path, method), false);
});
