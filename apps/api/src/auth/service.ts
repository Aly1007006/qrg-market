import {
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { and, eq, gt, isNull, sql } from 'drizzle-orm';
import { Database, type Transaction } from '../database.js';
import { sessions, users, adminSessions, auditLogs } from '../db/schema.js';
import { Passwords } from './passwords.js';
import {
  csrfFor,
  newToken,
  SESSION_LIFETIME_MS,
  tokenHash,
  validToken,
} from './tokens.js';
import type { Principal } from './metadata.js';

export async function revokeUserSessions(
  tx: Transaction,
  userId: string,
): Promise<void> {
  const adminRevoked = await tx
    .update(adminSessions)
    .set({ revokedAt: sql`now()` })
    .where(
      and(eq(adminSessions.userId, userId), isNull(adminSessions.revokedAt)),
    )
    .returning({ id: adminSessions.id });
  if (adminRevoked.length)
    await tx.insert(auditLogs).values({
      actor: 'USER:' + userId,
      action: 'ADMIN_SECURITY_REVOKE_ALL',
      resource: 'user',
      resourceId: userId,
      result: 'SUCCESS',
    });
  await tx
    .update(sessions)
    .set({ revokedAt: sql`now()` })
    .where(and(eq(sessions.userId, userId), isNull(sessions.revokedAt)));
}

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);
  constructor(
    @Inject(Database) private readonly database: Database,
    @Inject(Passwords) private readonly passwords: Passwords,
  ) {}

  async signup(email: string, password: string): Promise<void> {
    const passwordHash = await this.passwords.hash(password);
    // Identical status/body and hashing work for new and existing accounts. No auto-login.
    await this.database.client
      .insert(users)
      .values({ email, passwordHash })
      .onConflictDoNothing({ target: users.email });
    this.logger.log({ event: 'signup_request_processed' });
  }

  async login(email: string, password: string, previousToken?: string) {
    const [candidate] = await this.database.client
      .select()
      .from(users)
      .where(eq(users.email, email));
    const verified = await this.passwords.verify(
      candidate?.passwordHash,
      password,
    );
    if (!candidate || !verified || candidate.disabledAt) {
      this.logger.warn({ event: 'login_rejected' });
      throw new UnauthorizedException();
    }
    const issued = await this.database.client.transaction(async (tx) => {
      const [user] = await tx
        .select()
        .from(users)
        .where(eq(users.id, candidate.id))
        .for('no key update');
      // A concurrent password reset/disable invalidates verification done before this lock.
      if (
        !user ||
        user.disabledAt ||
        user.passwordHash !== candidate.passwordHash
      )
        throw new UnauthorizedException();
      if (previousToken) {
        await tx
          .update(sessions)
          .set({ revokedAt: sql`now()` })
          .where(
            and(
              eq(sessions.userId, user.id),
              eq(sessions.tokenHash, tokenHash(previousToken)),
              isNull(sessions.revokedAt),
            ),
          );
      }
      const active = await tx
        .select({ id: sessions.id })
        .from(sessions)
        .where(
          and(
            eq(sessions.userId, user.id),
            isNull(sessions.revokedAt),
            gt(sessions.expiresAt, sql`now()`),
          ),
        )
        .orderBy(sessions.createdAt);
      for (const old of active.slice(0, Math.max(0, active.length - 19))) {
        await tx
          .update(sessions)
          .set({ revokedAt: sql`now()` })
          .where(eq(sessions.id, old.id));
      }
      const token = newToken();
      const expiresAt = new Date(Date.now() + SESSION_LIFETIME_MS);
      const [session] = await tx
        .insert(sessions)
        .values({ userId: user.id, tokenHash: tokenHash(token), expiresAt })
        .returning({ id: sessions.id });
      if (!session) throw new Error('Session insert failed');
      return {
        token,
        expiresAt,
        csrfToken: csrfFor(token),
        sessionId: session.id,
        user: { id: user.id, email: user.email },
      };
    });
    this.logger.log({
      event: 'session_created',
      user_id: issued.user.id,
      session_id: issued.sessionId,
    });
    return issued;
  }

  async authenticate(token: string | undefined): Promise<Principal> {
    if (!validToken(token)) throw new UnauthorizedException();
    const hash = tokenHash(token);
    const [session] = await this.database.client
      .select({
        id: sessions.id,
        userId: sessions.userId,
        expiresAt: sessions.expiresAt,
      })
      .from(sessions)
      .innerJoin(users, eq(users.id, sessions.userId))
      .where(
        and(
          eq(sessions.tokenHash, hash),
          isNull(sessions.revokedAt),
          gt(sessions.expiresAt, sql`now()`),
          isNull(users.disabledAt),
        ),
      );
    if (!session) throw new UnauthorizedException();
    return {
      userId: session.userId,
      sessionId: session.id,
      tokenHash: hash,
      csrfToken: csrfFor(token),
      expiresAt: session.expiresAt,
    };
  }

  async withSession<T>(
    principal: Principal,
    operation: (tx: Transaction) => Promise<T>,
  ): Promise<T> {
    return this.database.client.transaction(async (tx) => {
      // Common lock order: user -> session check -> shop -> membership/resource.
      // Revalidation inside the transaction closes guard-to-write revocation races.
      const [user] = await tx
        .select({ id: users.id })
        .from(users)
        .where(and(eq(users.id, principal.userId), isNull(users.disabledAt)))
        .for('no key update');
      if (!user) throw new UnauthorizedException();
      const [session] = await tx
        .select({ id: sessions.id })
        .from(sessions)
        .where(
          and(
            eq(sessions.id, principal.sessionId),
            eq(sessions.userId, principal.userId),
            eq(sessions.tokenHash, principal.tokenHash),
            isNull(sessions.revokedAt),
            gt(sessions.expiresAt, sql`now()`),
          ),
        );
      if (!session) throw new UnauthorizedException();
      return operation(tx);
    });
  }

  me(principal: Principal) {
    return this.withSession(principal, async (tx) => {
      const [user] = await tx
        .select({ id: users.id, email: users.email })
        .from(users)
        .where(eq(users.id, principal.userId));
      if (!user) throw new UnauthorizedException();
      return {
        user,
        sessionId: principal.sessionId,
        expiresAt: principal.expiresAt,
        csrfToken: principal.csrfToken,
      };
    });
  }

  listSessions(principal: Principal) {
    return this.withSession(principal, (tx) =>
      tx
        .select({
          id: sessions.id,
          createdAt: sessions.createdAt,
          rotatedAt: sessions.rotatedAt,
          expiresAt: sessions.expiresAt,
        })
        .from(sessions)
        .where(
          and(
            eq(sessions.userId, principal.userId),
            isNull(sessions.revokedAt),
            gt(sessions.expiresAt, sql`now()`),
          ),
        )
        .orderBy(sessions.createdAt),
    );
  }

  async revoke(principal: Principal, sessionId: string): Promise<void> {
    await this.withSession(principal, async (tx) => {
      const [revoked] = await tx
        .update(sessions)
        .set({ revokedAt: sql`now()` })
        .where(
          and(
            eq(sessions.id, sessionId),
            eq(sessions.userId, principal.userId),
          ),
        )
        .returning({ id: sessions.id });
      if (!revoked) throw new NotFoundException();
    });
    this.logger.log({
      event: 'session_revoked',
      user_id: principal.userId,
      session_id: sessionId,
    });
  }

  async revokeAll(principal: Principal): Promise<void> {
    await this.withSession(principal, (tx) =>
      revokeUserSessions(tx, principal.userId),
    );
    this.logger.log({
      event: 'all_sessions_revoked',
      user_id: principal.userId,
    });
  }

  async rotate(principal: Principal) {
    const result = await this.withSession(principal, async (tx) => {
      const token = newToken();
      const [session] = await tx
        .update(sessions)
        .set({ tokenHash: tokenHash(token), rotatedAt: sql`now()` })
        .where(
          and(
            eq(sessions.id, principal.sessionId),
            eq(sessions.userId, principal.userId),
            eq(sessions.tokenHash, principal.tokenHash),
          ),
        )
        .returning({ expiresAt: sessions.expiresAt });
      if (!session) throw new UnauthorizedException();
      // Rotation never extends the absolute lifetime; previous token/CSRF immediately stop working.
      return { token, csrfToken: csrfFor(token), expiresAt: session.expiresAt };
    });
    this.logger.log({
      event: 'session_rotated',
      user_id: principal.userId,
      session_id: principal.sessionId,
    });
    return result;
  }
}
