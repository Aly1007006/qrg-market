import 'reflect-metadata';
import { Database } from '../database.js';
import { loadConfig } from '../config.js';
import { cleanupExpired } from './cleanup.js';

let database: Database | undefined;
try {
  const config = loadConfig();
  database = new Database(config);
  const result = await database.client.transaction((tx) =>
    cleanupExpired(tx, {
      customerRequestRetentionDays: config.customerRequestRetentionDays,
    }),
  );
  console.log(JSON.stringify({ event: 'data_cleanup_completed', ...result }));
} catch {
  console.error(JSON.stringify({ event: 'data_cleanup_failed' }));
  process.exitCode = 1;
} finally {
  await database?.onApplicationShutdown();
}
