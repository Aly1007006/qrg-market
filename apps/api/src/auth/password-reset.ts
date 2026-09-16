import {
  BadRequestException,
  Inject,
  Injectable,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import { and, eq, gt, isNull, sql } from 'drizzle-orm';
import { Database } from '../database.js';
import { passwordResetTokens, users } from '../db/schema.js';
import { PasswordResetDelivery } from './delivery.js';
import { Passwords } from './passwords.js';
import { newToken, RESET_LIFETIME_MS, tokenHash } from './tokens.js';
import { revokeUserSessions } from './service.js';

@Injectable()
export class PasswordResetService {
  private readonly logger = new Logger(PasswordResetService.name);
  constructor(
    @Inject(Database) private readonly database: Database,
    @Inject(Passwords) private readonly passwords: Passwords,
    @Inject(PasswordResetDelivery)
    private readonly delivery: PasswordResetDelivery,
  ) {}

  async request(email: string): Promise<void> {
    // Fail explicitly for every account until a real delivery adapter has been configured.
    if (!this.delivery.available()) throw new ServiceUnavailableException();
    const issued = await this.database.client.transaction(async (tx) => {
      const [user] = await tx
        .select({ id: users.id })
        .from(users)
        .where(and(eq(users.email, email), isNull(users.disabledAt)))
        .for('no key update');
      if (!user) return undefined;
      await tx
        .update(passwordResetTokens)
        .set({ consumedAt: sql`now()` })
        .where(
          and(
            eq(passwordResetTokens.userId, user.id),
            isNull(passwordResetTokens.consumedAt),
          ),
        );
      const token = newToken();
      const expiresAt = new Date(Date.now() + RESET_LIFETIME_MS);
      const [reset] = await tx
        .insert(passwordResetTokens)
        .values({ userId: user.id, tokenHash: tokenHash(token), expiresAt })
        .returning({ id: passwordResetTokens.id });
      if (!reset) throw new Error('Reset token insert failed');
      return { id: reset.id, token, expiresAt };
    });
    if (issued) {
      try {
        await this.delivery.send({
          email,
          token: issued.token,
          expiresAt: issued.expiresAt,
        });
      } catch {
        await this.database.client
          .update(passwordResetTokens)
          .set({ consumedAt: sql`now()` })
          .where(eq(passwordResetTokens.id, issued.id));
        this.logger.error({ event: 'password_reset_delivery_failed' });
        // Generic acceptance response does not reveal whether the address exists.
      }
    }
  }

  async confirm(token: string, password: string): Promise<void> {
    const hash = tokenHash(token);
    const [candidate] = await this.database.client
      .select({ userId: passwordResetTokens.userId })
      .from(passwordResetTokens)
      .where(
        and(
          eq(passwordResetTokens.tokenHash, hash),
          isNull(passwordResetTokens.consumedAt),
          gt(passwordResetTokens.expiresAt, sql`now()`),
        ),
      );
    if (!candidate) throw new BadRequestException();
    const passwordHash = await this.passwords.hash(password);
    await this.database.client.transaction(async (tx) => {
      const [user] = await tx
        .select({ id: users.id })
        .from(users)
        .where(and(eq(users.id, candidate.userId), isNull(users.disabledAt)))
        .for('no key update');
      if (!user) throw new BadRequestException();
      const [reset] = await tx
        .update(passwordResetTokens)
        .set({ consumedAt: sql`now()` })
        .where(
          and(
            eq(passwordResetTokens.tokenHash, hash),
            eq(passwordResetTokens.userId, user.id),
            isNull(passwordResetTokens.consumedAt),
            gt(passwordResetTokens.expiresAt, sql`now()`),
          ),
        )
        .returning({ id: passwordResetTokens.id });
      if (!reset) throw new BadRequestException();
      await tx.update(users).set({ passwordHash }).where(eq(users.id, user.id));
      await tx
        .update(passwordResetTokens)
        .set({ consumedAt: sql`now()` })
        .where(
          and(
            eq(passwordResetTokens.userId, user.id),
            isNull(passwordResetTokens.consumedAt),
          ),
        );
      await revokeUserSessions(tx, user.id);
    });
    this.logger.log({
      event: 'password_reset_completed',
      user_id: candidate.userId,
    });
  }
}
