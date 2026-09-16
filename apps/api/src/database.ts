import {
  Inject,
  Injectable,
  Logger,
  type OnApplicationShutdown,
} from '@nestjs/common';
import { drizzle } from 'drizzle-orm/node-postgres';
import { sql } from 'drizzle-orm';
import pg from 'pg';
import { APP_CONFIG, type AppConfig } from './config.js';

@Injectable()
export class Database implements OnApplicationShutdown {
  private readonly pool: pg.Pool;
  readonly client;

  constructor(@Inject(APP_CONFIG) config: AppConfig) {
    this.pool = new pg.Pool({
      connectionString: config.databaseUrl,
      ssl: config.databaseSsl ? { rejectUnauthorized: true } : false,
      max: config.environment === 'test' ? 2 : 10,
      connectionTimeoutMillis: 3000,
      idleTimeoutMillis: 10000,
      statement_timeout: 5000,
      query_timeout: 6000,
    });
    this.pool.on('error', () => {
      new Logger(Database.name).error({ event: 'database_pool_error' });
    });
    this.client = drizzle(this.pool);
  }

  async ping(): Promise<void> {
    await this.client.execute(sql`SELECT 1`);
  }

  async onApplicationShutdown(): Promise<void> {
    await this.pool.end();
  }
}

export type Transaction = Parameters<
  Parameters<Database['client']['transaction']>[0]
>[0];
