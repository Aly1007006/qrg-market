import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadConfig } from '../src/config.js';

const base = {
  DATABASE_URL: 'postgresql://test:local-only@localhost:5432/qrg_test',
  APP_ORIGIN: 'https://qrg.example',
  AUTH_RATE_LIMIT_SECRET: 'test-rate-limit-secret-at-least-32-characters',
  INTERNAL_PROXY_SECRET: 'test-internal-proxy-secret-at-least-32-characters',
};
await test('development, test and production have explicit safe defaults', () => {
  assert.equal(loadConfig(base).swaggerEnabled, true);
  assert.equal(loadConfig({ ...base, NODE_ENV: 'test' }).swaggerEnabled, false);
  const production = loadConfig({ ...base, NODE_ENV: 'production' });
  assert.equal(production.databaseSsl, true);
  assert.equal(production.swaggerEnabled, false);
  assert.equal(production.customerRequestsEnabled, false);
  assert.equal(production.customerRequestRetentionDays, null);
  const requests = loadConfig({
    ...base,
    NODE_ENV: 'production',
    CUSTOMER_REQUESTS_ENABLED: 'true',
    CUSTOMER_REQUEST_RETENTION_DAYS: '45',
  });
  assert.equal(requests.customerRequestsEnabled, true);
  assert.equal(requests.customerRequestRetentionDays, 45);
  assert.ok(Object.isFrozen(production));
});
await test('rejects malformed configuration without leaking values', () => {
  for (const override of [
    { NODE_ENV: 'staging' },
    { PORT: '1.5' },
    { PORT: '0' },
    { PORT: '65536' },
    { PORT: '3e3' },
    { DATABASE_URL: '' },
    { DATABASE_URL: 'https://secret.example/db' },
    { DATABASE_URL: `${base.DATABASE_URL}?sslmode=no-verify` },
    { DATABASE_SSL: 'yes' },
    { SWAGGER_ENABLED: '1' },
    { NODE_ENV: 'production', DATABASE_SSL: 'false' },
    { NODE_ENV: 'production', SWAGGER_ENABLED: 'true' },
    { APP_ORIGIN: 'https://qrg.example/path' },
    { APP_ORIGIN: 'https://user:secret@qrg.example' },
    { NODE_ENV: 'production', APP_ORIGIN: 'http://qrg.example' },
    { NODE_ENV: 'production', APP_ORIGIN: '' },
    { NODE_ENV: 'production', AUTH_RATE_LIMIT_SECRET: '' },
    { NODE_ENV: 'production', INTERNAL_PROXY_SECRET: '' },
    { AUTH_RATE_LIMIT_SECRET: 'short' },
    { INTERNAL_PROXY_SECRET: 'short' },
    { CUSTOMER_REQUESTS_ENABLED: 'yes' },
    { CUSTOMER_REQUEST_RETENTION_DAYS: '0' },
    { CUSTOMER_REQUEST_RETENTION_DAYS: '1.5' },
    { CUSTOMER_REQUEST_RETENTION_DAYS: '3651' },
    { NODE_ENV: 'production', CUSTOMER_REQUESTS_ENABLED: 'true' },
  ]) {
    assert.throws(
      () => loadConfig({ ...base, ...override }),
      (error: unknown) => {
        assert.ok(error instanceof Error);
        assert.ok(!error.message.includes('secret.example'));
        assert.ok(!error.message.includes('local-only'));
        return true;
      },
    );
  }
});
