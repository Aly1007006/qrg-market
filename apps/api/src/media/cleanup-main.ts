import 'reflect-metadata';
import { Database } from '../database.js';
import { loadConfig } from '../config.js';
import { cleanupMedia } from './service.js';
import { S3ObjectStorage } from './storage.js';
let db: Database | undefined;
let storage: S3ObjectStorage | undefined;
try {
  db = new Database(loadConfig());
  storage = new S3ObjectStorage();
  console.log(
    JSON.stringify({
      event: 'media_cleanup_completed',
      ...(await cleanupMedia(db, storage)),
    }),
  );
} catch {
  console.error(JSON.stringify({ event: 'media_cleanup_failed' }));
  process.exitCode = 1;
} finally {
  storage?.onApplicationShutdown();
  await db?.onApplicationShutdown();
}
