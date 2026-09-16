import { createHmac } from 'node:crypto';
import { HttpException, Inject, Injectable } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import { Database } from '../database.js';
import { APP_CONFIG, type AppConfig } from '../config.js';
import { authRateLimits } from '../db/schema.js';
import type { AuthAction } from './metadata.js';

@Injectable()
export class AuthRateLimiter {
  constructor(
    @Inject(Database) private readonly database: Database,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}
  async consume(key: string, limit: number): Promise<void> {
    const keyHash = createHmac('sha256', this.config.rateLimitSecret)
      .update(key)
      .digest('hex');
    const [bucket] = await this.database.client
      .insert(authRateLimits)
      .values({
        keyHash,
        hits: 1,
        windowEndsAt: sql`now() + interval '15 minutes'`,
      })
      .onConflictDoUpdate({
        target: authRateLimits.keyHash,
        set: {
          hits: sql`CASE WHEN ${authRateLimits.windowEndsAt} <= now() THEN 1 ELSE LEAST(${authRateLimits.hits} + 1, 1000000) END`,
          windowEndsAt: sql`CASE WHEN ${authRateLimits.windowEndsAt} <= now() THEN now() + interval '15 minutes' ELSE ${authRateLimits.windowEndsAt} END`,
        },
      })
      .returning({ hits: authRateLimits.hits });
    if (!bucket || bucket.hits > limit)
      throw new HttpException('Too many requests', 429);
  }
  async check(
    action: AuthAction,
    ip: string,
    email: string | undefined,
  ): Promise<void> {
    await this.consume(`${action}:ip:${ip}`, action === 'login' ? 60 : 20);
    if (email)
      await this.consume(
        `${action}:email:${email.toLowerCase().trim()}`,
        action === 'login' ? 10 : 5,
      );
  }
}
