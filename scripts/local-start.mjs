// Local-only launcher. Credentials stay in child environment, not source or logs.
import { randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { parseEnv } from 'node:util';
import { execFileSync, spawn } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { resolve } from 'node:path';

const root = fileURLToPath(new URL('../', import.meta.url));
export function localEnvironment(inherited, rootEnv, apiEnv, existingDbEnv) {
  const result = { ...inherited, ...rootEnv };
  for (const name of [
    'POSTGRES_PASSWORD',
    'ADMIN_MFA_ENCRYPTION_KEY',
    'QRG_INTERNAL_PROXY_SECRET',
  ]) {
    if (inherited[name]?.trim()) result[name] = inherited[name];
  }
  result.POSTGRES_PASSWORD ||=
    existingDbEnv.POSTGRES_PASSWORD || randomBytes(32).toString('base64url');
  if (!/^[A-Za-z0-9_-]{12,128}$/.test(result.POSTGRES_PASSWORD))
    throw new Error(
      'Local POSTGRES_PASSWORD must use 12-128 URL-safe characters. Existing data will not be replaced.',
    );
  result.ADMIN_MFA_ENCRYPTION_KEY ||= apiEnv.ADMIN_MFA_ENCRYPTION_KEY || '';
  result.QRG_INTERNAL_PROXY_SECRET ||= randomBytes(32).toString('hex');
  if (
    result.QRG_INTERNAL_PROXY_SECRET.length < 32 ||
    result.QRG_INTERNAL_PROXY_SECRET.length > 128 ||
    result.QRG_INTERNAL_PROXY_SECRET ===
      'local-development-internal-proxy-key-not-for-production'
  )
    throw new Error(
      'Configure a random local QRG_INTERNAL_PROXY_SECRET (32-128 characters).',
    );
  return result;
}
function envFile(path) {
  try {
    return parseEnv(readFileSync(path, 'utf8'));
  } catch (error) {
    if (error.code === 'ENOENT') return {};
    throw new Error('Cannot read local environment configuration.');
  }
}
function existingDatabaseEnvironment() {
  const names = execFileSync(
    'docker',
    [
      'ps',
      '-a',
      '--filter',
      'label=com.docker.compose.project=qrg-market-local',
      '--filter',
      'label=com.docker.compose.service=db',
      '--filter',
      'label=com.docker.compose.container-number',
      '--format',
      '{{.Names}}',
    ],
    { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] },
  )
    .trim()
    .split('\n')
    .filter(Boolean);
  if (!names.length) return {};
  if (names.length !== 1)
    throw new Error(
      'Multiple local QRG database containers found; configuration must be resolved explicitly.',
    );
  const [container] = JSON.parse(
    execFileSync('docker', ['inspect', names[0]], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    }),
  );
  return Object.fromEntries(
    container.Config.Env.map((value) => {
      const index = value.indexOf('=');
      return [value.slice(0, index), value.slice(index + 1)];
    }),
  );
}
async function main() {
  const env = localEnvironment(
    process.env,
    envFile(resolve(root, '.env')),
    envFile(resolve(root, 'apps/api/.env')),
    existingDatabaseEnvironment(),
  );
  console.log(
    'Starting local QRG MARKET at http://localhost:3000. Existing volumes are preserved; secrets are not printed.',
  );
  const child = spawn(
    'docker',
    ['compose', '--profile', 'app', 'up', '-d', '--build', '--wait'],
    { cwd: root, env, stdio: 'inherit' },
  );
  await new Promise((resolve, reject) => {
    child.once('error', reject);
    child.once('exit', (code) => {
      process.exitCode = code ?? 1;
      resolve();
    });
  });
}
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  main().catch(() => {
    console.error(
      'Local start failed. Check Docker and local configuration; no database or volume was deleted.',
    );
    process.exitCode = 1;
  });
}
