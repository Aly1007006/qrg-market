import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import type { AppConfig } from '../config.js';

export async function runMigrations(
  config: AppConfig,
  folder = fileURLToPath(new URL('../../drizzle', import.meta.url)),
): Promise<void> {
  const pool = new pg.Pool({
    connectionString: config.databaseUrl,
    ssl: config.databaseSsl ? { rejectUnauthorized: true } : false,
    max: 1,
    connectionTimeoutMillis: 5000,
    statement_timeout: 60000,
  });
  try {
    const connection = await pool.connect();
    try {
      // Serializes migration runners, including multiple deploy jobs.
      await connection.query('SELECT pg_advisory_lock(71624701)');
      try {
        await migrate(drizzle(connection), { migrationsFolder: folder });
      } finally {
        await connection.query('SELECT pg_advisory_unlock(71624701)');
      }
    } finally {
      connection.release();
    }
  } finally {
    await pool.end();
  }
}
