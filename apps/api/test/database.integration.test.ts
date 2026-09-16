import 'reflect-metadata';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sql } from 'drizzle-orm';
import { Database } from '../src/database.js';
import { loadConfig } from '../src/config.js';

await test('real PostgreSQL: connection, required extensions and Drizzle transaction rollback', async () => {
  // This test fails rather than silently skipping when DATABASE_URL is missing.
  const config = loadConfig({ ...process.env, NODE_ENV: 'test' });
  const database = new Database(config);
  try {
    await database.ping();
    const extensions = await database.client.execute<{ extname: string }>(
      sql`SELECT extname FROM pg_extension WHERE extname IN ('postgis', 'pg_trgm') ORDER BY extname`,
    );
    assert.deepEqual(
      extensions.rows.map((row) => row.extname),
      ['pg_trgm', 'postgis'],
    );
    await assert.rejects(
      database.client.transaction(async (tx) => {
        await tx.execute(
          sql`CREATE TEMP TABLE qrg_phase0_rollback_probe (id integer PRIMARY KEY)`,
        );
        await tx.execute(sql`INSERT INTO qrg_phase0_rollback_probe VALUES (1)`);
        throw new Error('intentional rollback');
      }),
      /intentional rollback/,
    );
    const result = await database.client.execute<{ relation: string | null }>(
      sql`SELECT to_regclass('pg_temp.qrg_phase0_rollback_probe')::text AS relation`,
    );
    assert.equal(result.rows[0]?.relation, null);
  } finally {
    await database.onApplicationShutdown();
  }
});
