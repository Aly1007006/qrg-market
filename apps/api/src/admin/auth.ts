import {
  ForbiddenException,
  Inject,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { and, eq, gt, isNull, sql } from 'drizzle-orm';
import { Database, type Transaction } from '../database.js';
import { adminAccounts, adminSessions, users } from '../db/schema.js';
import { Passwords } from '../auth/passwords.js';
import { csrfFor, newToken, tokenHash, validToken } from '../auth/tokens.js';
import {
  ADMIN_IDLE_MS,
  ADMIN_LIFETIME_MS,
  AdminSecondFactor,
} from './security.js';
import { appendAudit, AuditLog } from './audit.js';
import type { AdminPermission, AdminPrincipal } from './metadata.js';
export function adminPermissions(
  a: typeof adminAccounts.$inferSelect,
): AdminPermission[] {
  if (a.mustChangePassword || !a.totpEncrypted) return ['session', 'security'];
  const roles: Record<string, AdminPermission[]> = {
    SUPER_ADMIN: [
      'session',
      'security',
      'overview.read',
      'moderation.read',
      'moderation.write',
      'moderation.suspend',
      'audit.read',
      'users.read',
      'users.write',
      'products.read',
      'products.moderate',
      'subscriptions.read',
      'admins.write',
    ],
    MODERATION_ADMIN: [
      'session',
      'security',
      'overview.read',
      'moderation.read',
      'moderation.write',
      'moderation.suspend',
      'products.read',
      'products.moderate',
    ],
    SUPPORT_ADMIN: [
      'session',
      'security',
      'moderation.read',
      'users.read',
      'products.read',
    ],
    FINANCE_ADMIN: ['session', 'security', 'subscriptions.read'],
  };
  if (roles[a.role]) return roles[a.role]!;
  return [
    'session',
    'security',
    'moderation.read',
    ...(a.canModerate ? ['moderation.write' as const] : []),
    ...(a.canSuspend ? ['moderation.suspend' as const] : []),
    ...(a.canReadAudit ? ['audit.read' as const] : []),
  ];
}
@Injectable()
export class AdminAuth {
  constructor(
    @Inject(Database) private readonly db: Database,
    @Inject(Passwords) private readonly passwords: Passwords,
    @Inject(AdminSecondFactor) private readonly secondFactor: AdminSecondFactor,
    @Inject(AuditLog) private readonly audit: AuditLog,
  ) {}
  async login(email: string, password: string, code: string) {
    let actor = 'ANONYMOUS';
    try {
      const [candidate] = await this.db.client
        .select()
        .from(users)
        .where(eq(users.email, email));
      const verified = await this.passwords.verify(
        candidate?.passwordHash,
        password,
      );
      if (!candidate || !verified || candidate.disabledAt)
        throw new UnauthorizedException();
      actor = 'USER:' + candidate.id;
      return await this.db.client.transaction(async (tx) => {
        const [user] = await tx
          .select()
          .from(users)
          .where(eq(users.id, candidate.id))
          .for('no key update');
        if (
          !user ||
          user.disabledAt ||
          user.passwordHash !== candidate.passwordHash
        )
          throw new UnauthorizedException();
        const [account] = await tx
          .select()
          .from(adminAccounts)
          .where(eq(adminAccounts.userId, user.id))
          .for('update');
        if (!account?.enabled) throw new UnauthorizedException();
        const recoveryHash = /^[A-Za-z0-9_-]{32}$/.test(code)
          ? tokenHash(code)
          : null;
        const recovery =
          recoveryHash !== null &&
          account.recoveryHashes.includes(recoveryHash);
        const step =
          account.totpEncrypted && !recovery
            ? this.secondFactor.verify(
                account.totpEncrypted,
                user.id,
                code,
                account.lastTotpStep,
              )
            : account.lastTotpStep;
        await tx
          .update(adminAccounts)
          .set({
            lastTotpStep: step,
            ...(recovery
              ? {
                  recoveryHashes: account.recoveryHashes.filter(
                    (hash) => hash !== recoveryHash,
                  ),
                }
              : {}),
          })
          .where(eq(adminAccounts.userId, user.id));
        // One active admin session per account; a new MFA login revokes old tokens.
        await tx
          .update(adminSessions)
          .set({ revokedAt: sql`now()` })
          .where(
            and(
              eq(adminSessions.userId, user.id),
              isNull(adminSessions.revokedAt),
            ),
          );
        const token = newToken();
        const [session] = await tx
          .insert(adminSessions)
          .values({
            userId: user.id,
            tokenHash: tokenHash(token),
            expiresAt: sql`now() + interval '1 hour'`,
            mfaVerifiedAt: account.totpEncrypted ? new Date() : null,
          })
          .returning();
        if (!session) throw new Error('Admin session insert failed');
        await appendAudit(tx, {
          actor,
          action: 'ADMIN_LOGIN',
          resource: 'admin-session',
          resourceId: session.id,
          result: 'SUCCESS',
        });
        return {
          token,
          expiresAt: session.expiresAt,
          csrfToken: csrfFor(token),
        };
      });
    } catch (error) {
      await this.audit.append({
        actor,
        action: 'ADMIN_LOGIN',
        resource: 'admin-session',
        result: 'DENIED',
      });
      throw error;
    }
  }
  async authenticate(token: string | undefined): Promise<AdminPrincipal> {
    if (!validToken(token)) throw new UnauthorizedException();
    const [s] = await this.db.client
      .select({ id: adminSessions.id, userId: adminSessions.userId })
      .from(adminSessions)
      .where(eq(adminSessions.tokenHash, tokenHash(token)));
    if (!s) throw new UnauthorizedException();
    const p: AdminPrincipal = {
      kind: 'ADMIN',
      userId: s.userId,
      sessionId: s.id,
      tokenHash: tokenHash(token),
      csrfToken: csrfFor(token),
    };
    await this.withPermission(p, 'session', () => undefined);
    return p;
  }
  withPermission<T>(
    p: AdminPrincipal,
    permission: AdminPermission,
    operation: (
      tx: Transaction,
      account: typeof adminAccounts.$inferSelect,
      session: typeof adminSessions.$inferSelect,
    ) => Promise<T> | T,
  ) {
    return this.db.client.transaction(async (tx) => {
      if (['admins.write', 'users.write', 'security'].includes(permission))
        await tx.execute(sql`SELECT pg_advisory_xact_lock(71624802)`);
      const [u] = await tx
        .select({ id: users.id })
        .from(users)
        .where(and(eq(users.id, p.userId), isNull(users.disabledAt)))
        .for('no key update');
      if (!u || p.kind !== 'ADMIN') throw new UnauthorizedException();
      const [a] = await tx
        .select()
        .from(adminAccounts)
        .where(eq(adminAccounts.userId, u.id))
        .for('update');
      const [s] = await tx
        .select()
        .from(adminSessions)
        .where(
          and(
            eq(adminSessions.id, p.sessionId),
            eq(adminSessions.userId, u.id),
            eq(adminSessions.tokenHash, p.tokenHash),
            isNull(adminSessions.revokedAt),
            gt(adminSessions.expiresAt, sql`now()`),
            gt(adminSessions.lastSeenAt, new Date(Date.now() - ADMIN_IDLE_MS)),
          ),
        )
        .for('update');
      if (
        !a?.enabled ||
        !s ||
        Date.now() - s.createdAt.getTime() >= ADMIN_LIFETIME_MS ||
        (!s.mfaVerifiedAt && !['session', 'security'].includes(permission))
      )
        throw new UnauthorizedException();
      if (!adminPermissions(a).includes(permission))
        throw new ForbiddenException();
      await tx
        .update(adminSessions)
        .set({ lastSeenAt: sql`now()` })
        .where(eq(adminSessions.id, s.id));
      return operation(tx, a, s);
    });
  }
  me(p: AdminPrincipal) {
    return this.withPermission(p, 'session', (_tx, a, s) => ({
      userId: p.userId,
      role: a.role,
      mustChangePassword: a.mustChangePassword,
      mfaEnrolled: Boolean(a.totpEncrypted),
      permissions: adminPermissions(a),
      expiresAt: s.expiresAt,
      csrfToken: p.csrfToken,
    }));
  }
  async logout(p: AdminPrincipal) {
    await this.withPermission(p, 'session', async (tx, _a, s) => {
      await tx
        .update(adminSessions)
        .set({ revokedAt: sql`now()` })
        .where(eq(adminSessions.id, s.id));
      await appendAudit(tx, {
        actor: 'USER:' + p.userId,
        action: 'ADMIN_LOGOUT',
        resource: 'admin-session',
        resourceId: s.id,
        result: 'SUCCESS',
      });
    });
  }
  rotate(p: AdminPrincipal) {
    return this.withPermission(p, 'session', async (tx, _a, s) => {
      const token = newToken();
      await tx
        .update(adminSessions)
        .set({ tokenHash: tokenHash(token), updatedAt: sql`now()` })
        .where(eq(adminSessions.id, s.id));
      await appendAudit(tx, {
        actor: 'USER:' + p.userId,
        action: 'ADMIN_ROTATE',
        resource: 'admin-session',
        resourceId: s.id,
        result: 'SUCCESS',
      });
      return { token, expiresAt: s.expiresAt, csrfToken: csrfFor(token) };
    });
  }
}
