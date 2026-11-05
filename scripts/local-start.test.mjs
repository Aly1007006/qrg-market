import { test } from 'node:test';
import assert from 'node:assert/strict';
import { localEnvironment } from './local-start.mjs';
import { readFileSync } from 'node:fs';

test('Compose requires the same proof key on both sides and launcher excludes containers inheriting image labels', () => {
  const compose = readFileSync(
    new URL('../compose.yaml', import.meta.url),
    'utf8',
  );
  assert.match(
    compose,
    /INTERNAL_PROXY_SECRET: \$\{QRG_INTERNAL_PROXY_SECRET:\?/,
  );
  assert.match(
    compose,
    /QRG_INTERNAL_PROXY_SECRET: \$\{QRG_INTERNAL_PROXY_SECRET:\?/,
  );
  assert.doesNotMatch(
    compose,
    /local-development-internal-proxy-key-not-for-production/,
  );
  assert.match(
    readFileSync(new URL('./local-start.mjs', import.meta.url), 'utf8'),
    /label=com\.docker\.compose\.container-number/,
  );
});
test('local launcher preserves existing database credentials and MFA key without committing generated secrets', () => {
  const env = localEnvironment(
    {},
    {},
    { ADMIN_MFA_ENCRYPTION_KEY: 'existing-local-key' },
    { POSTGRES_PASSWORD: 'existing-local-db-password' },
  );
  assert.equal(env.POSTGRES_PASSWORD, 'existing-local-db-password');
  assert.equal(env.ADMIN_MFA_ENCRYPTION_KEY, 'existing-local-key');
  assert.match(env.QRG_INTERNAL_PROXY_SECRET, /^[0-9a-f]{64}$/);
  assert.notEqual(
    env.QRG_INTERNAL_PROXY_SECRET,
    localEnvironment({}, {}, {}, {}).QRG_INTERNAL_PROXY_SECRET,
  );
});
test('local launcher honors explicit values and rejects unsafe database/proxy credentials', () => {
  const env = localEnvironment(
    {
      POSTGRES_PASSWORD: 'explicit-local-password',
      QRG_INTERNAL_PROXY_SECRET: 'a'.repeat(64),
    },
    { POSTGRES_PASSWORD: 'file-local-password' },
    {},
    {},
  );
  assert.equal(env.POSTGRES_PASSWORD, 'explicit-local-password');
  assert.equal(env.QRG_INTERNAL_PROXY_SECRET, 'a'.repeat(64));
  assert.throws(() =>
    localEnvironment({}, { POSTGRES_PASSWORD: 'bad:password' }, {}, {}),
  );
  assert.throws(() =>
    localEnvironment(
      {},
      {
        QRG_INTERNAL_PROXY_SECRET:
          'local-development-internal-proxy-key-not-for-production',
      },
      {},
      {},
    ),
  );
});
