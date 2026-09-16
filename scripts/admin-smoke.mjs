import { spawn } from 'node:child_process';
const child = spawn(
  process.execPath,
  ['--test', '.test-dist/test/admin.integration.test.js'],
  {
    cwd: new URL('../apps/api/', import.meta.url),
    stdio: 'inherit',
    env: { ...process.env, QRG_TEST_BUILT_ADMIN: 'true' },
  },
);
child.on('error', () => {
  process.exitCode = 1;
});
child.on('exit', (code) => {
  process.exitCode = code ?? 1;
});
