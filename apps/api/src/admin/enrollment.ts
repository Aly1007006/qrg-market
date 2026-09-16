import {
  ConflictException,
  Inject,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { randomBytes } from 'node:crypto';
import { Secret, TOTP } from 'otpauth';
import { and, eq, isNull, sql } from 'drizzle-orm';
import { adminAccounts, adminSessions, users } from '../db/schema.js';
import { Passwords } from '../auth/passwords.js';
import { revokeUserSessions } from '../auth/service.js';
import { tokenHash } from '../auth/tokens.js';
import { AdminAuth } from './auth.js';
import {
  AdminSecondFactor,
  decryptTotp,
  encryptionKey,
  encryptTotp,
} from './security.js';
import { appendAudit } from './audit.js';
import type { AdminPrincipal } from './metadata.js';
import type { AdminPasswordDto } from './enrollment.dto.js';

@Injectable()
export class AdminEnrollment {
  constructor(
    @Inject(AdminAuth) private readonly auth: AdminAuth,
    @Inject(Passwords) private readonly passwords: Passwords,
    @Inject(AdminSecondFactor) private readonly factor: AdminSecondFactor,
  ) {}
  changePassword(p: AdminPrincipal, body: AdminPasswordDto) {
    return this.auth.withPermission(p, 'security', async (tx) => {
      const [user] = await tx
        .select()
        .from(users)
        .where(eq(users.id, p.userId));
      if (
        !user ||
        !(await this.passwords.verify(user.passwordHash, body.currentPassword))
      )
        throw new UnauthorizedException();
      if (body.currentPassword === body.newPassword)
        throw new ConflictException();
      await tx
        .update(users)
        .set({
          passwordHash: await this.passwords.hash(body.newPassword),
          updatedAt: new Date(),
        })
        .where(eq(users.id, p.userId));
      await tx
        .update(adminAccounts)
        .set({ mustChangePassword: false, updatedAt: new Date() })
        .where(eq(adminAccounts.userId, p.userId));
      await revokeUserSessions(tx, p.userId);
      await appendAudit(tx, {
        actor: 'USER:' + p.userId,
        action: 'ADMIN_PASSWORD_CHANGED',
        resource: 'user',
        resourceId: p.userId,
        result: 'SUCCESS',
      });
      return { signInRequired: true };
    });
  }
  setup(p: AdminPrincipal) {
    return this.auth.withPermission(p, 'security', async (tx, account) => {
      if (account.mustChangePassword || account.totpEncrypted)
        throw new ConflictException();
      const key = encryptionKey();
      const secret = account.pendingTotpEncrypted
        ? decryptTotp(account.pendingTotpEncrypted, p.userId, key)
        : new Secret({ size: 20 }).base32;
      if (!account.pendingTotpEncrypted)
        await tx
          .update(adminAccounts)
          .set({ pendingTotpEncrypted: encryptTotp(secret, p.userId, key) })
          .where(eq(adminAccounts.userId, p.userId));
      await appendAudit(tx, {
        actor: 'USER:' + p.userId,
        action: 'ADMIN_MFA_SETUP',
        resource: 'user',
        resourceId: p.userId,
        result: 'SUCCESS',
      });
      return {
        secret,
        uri: new TOTP({
          issuer: 'QRG MARKET',
          label: 'Admin ' + p.userId,
          secret,
          algorithm: 'SHA1',
          digits: 6,
          period: 30,
        }).toString(),
      };
    });
  }
  verify(p: AdminPrincipal, code: string) {
    return this.auth.withPermission(
      p,
      'security',
      async (tx, account, session) => {
        if (
          account.mustChangePassword ||
          account.totpEncrypted ||
          !account.pendingTotpEncrypted
        )
          throw new ConflictException();
        const step = this.factor.verify(
          account.pendingTotpEncrypted,
          p.userId,
          code,
          -1,
        );
        const recoveryCodes = Array.from({ length: 10 }, () =>
          randomBytes(24).toString('base64url'),
        );
        await tx
          .update(adminAccounts)
          .set({
            totpEncrypted: account.pendingTotpEncrypted,
            pendingTotpEncrypted: null,
            lastTotpStep: step,
            recoveryHashes: recoveryCodes.map((code) => tokenHash(code)),
            updatedAt: new Date(),
          })
          .where(eq(adminAccounts.userId, p.userId));
        await tx
          .update(adminSessions)
          .set({ revokedAt: sql`now()` })
          .where(
            and(
              eq(adminSessions.userId, p.userId),
              isNull(adminSessions.revokedAt),
            ),
          );
        await appendAudit(tx, {
          actor: 'USER:' + p.userId,
          action: 'ADMIN_MFA_ENABLED',
          resource: 'admin-session',
          resourceId: session.id,
          result: 'SUCCESS',
        });
        return { recoveryCodes, signInRequired: true };
      },
    );
  }
}
