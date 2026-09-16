import { Database } from '../database.js';
import { loadConfig } from '../config.js';
import { bootstrapAdmin } from './bootstrap.js';
let db: Database | undefined;
try {
  db = new Database(loadConfig());
  const result = await bootstrapAdmin(
    db,
    process.env.ADMIN_INITIAL_EMAIL ?? '',
    process.env.ADMIN_INITIAL_PASSWORD ?? '',
  );
  console.log(
    JSON.stringify({
      event: 'admin_bootstrap_completed',
      created: result.created,
    }),
  );
} catch {
  console.error(
    JSON.stringify({
      event: 'admin_bootstrap_failed',
      message:
        'Check secret injection, existing account and database availability',
    }),
  );
  process.exitCode = 1;
} finally {
  await db?.onApplicationShutdown();
}
