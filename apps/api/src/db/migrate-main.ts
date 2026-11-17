import { loadConfig } from '../config.js';
import { runMigrations } from './migrate.js';

try {
  await runMigrations(loadConfig());
  console.log(JSON.stringify({ event: 'migrations_completed' }));
} catch (error) {
  const diagnostics =
    error instanceof Error
      ? {
          errorName: error.name,
          errorCode:
            'code' in error && typeof error.code === 'string'
              ? error.code
              : undefined,
        }
      : undefined;
  console.error(
    JSON.stringify({
      event: 'migrations_failed',
      message: 'Check database access and migration files',
      diagnostics,
    }),
  );
  process.exitCode = 1;
}
