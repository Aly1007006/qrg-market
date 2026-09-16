import { loadConfig } from '../config.js';
import { runMigrations } from './migrate.js';

try {
  await runMigrations(loadConfig());
  console.log(JSON.stringify({ event: 'migrations_completed' }));
} catch {
  console.error(
    JSON.stringify({
      event: 'migrations_failed',
      message: 'Check database access and migration files',
    }),
  );
  process.exitCode = 1;
}
