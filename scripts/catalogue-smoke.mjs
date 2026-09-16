import { spawn } from 'node:child_process';
import { once } from 'node:events';
// Uses real Nest/PostgreSQL fixture setup in the dedicated *_test database,
// then runs the built Next server against that API. No production mock adapter.
const child = spawn(
  process.execPath,
  [
    '--test',
    '--test-concurrency=1',
    '.test-dist/test/catalogue.integration.test.js',
  ],
  {
    cwd: new URL('../apps/api/', import.meta.url),
    stdio: 'inherit',
    env: { ...process.env, QRG_TEST_BUILT_WEB: 'true' },
  },
);
const [code] = await once(child, 'exit');
process.exitCode = code ?? 1;
