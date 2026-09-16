import 'reflect-metadata';
import { Database } from '../database.js';
import { loadConfig } from '../config.js';
import { cleanupExpired } from './cleanup.js';

let database: Database | undefined;
try {
  database = new Database(loadConfig());
  const result = await database.client.transaction((tx) => cleanupExpired(tx));
  console.log(JSON.stringify({ event: 'auth_cleanup_completed', ...result }));
} catch {
  console.error(JSON.stringify({ event: 'auth_cleanup_failed' }));
  process.exitCode = 1;
} finally {
  await database?.onApplicationShutdown();
}
