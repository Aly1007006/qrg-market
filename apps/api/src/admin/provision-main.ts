import { and, eq, isNull, sql } from 'drizzle-orm';
import { Database } from '../database.js';
import { loadConfig } from '../config.js';
import { adminAccounts, adminSessions, users } from '../db/schema.js';
import { appendAudit } from './audit.js';
import { encryptionKey, encryptTotp, TotpSecondFactor } from './security.js';
import { protectLastSuperAdmin } from './control.js';
// Operator-only CLI, never reachable through HTTP. Values supplied by a secret manager,
// not command-line arguments. No bootstrap administrator or default credentials.
let db: Database | undefined;
try {
  const userId = process.env.ADMIN_PROVISION_USER_ID ?? '';
  const operator = process.env.ADMIN_PROVISION_OPERATOR ?? '';
  const action = process.env.ADMIN_PROVISION_ACTION ?? '';
  if (
    !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(
      userId,
    ) ||
    !/^[A-Za-z0-9._-]{1,80}$/.test(operator) ||
    !['grant', 'revoke'].includes(action)
  )
    throw new Error('Invalid provisioning inputs');
  const flag = (name: string) => {
    const v = process.env[name] ?? 'false';
    if (!['true', 'false'].includes(v)) throw new Error('Invalid permission');
    return v === 'true';
  };
  const grants = {
    canModerate: flag('ADMIN_PROVISION_MODERATE'),
    canSuspend: flag('ADMIN_PROVISION_SUSPEND'),
    canReadAudit: flag('ADMIN_PROVISION_AUDIT'),
  };
  db = new Database(loadConfig());
  await db.client.transaction(async (tx) => {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(71624802)`);
    const [user] = await tx
      .select({ id: users.id })
      .from(users)
      .where(and(eq(users.id, userId), isNull(users.disabledAt)))
      .for('no key update');
    if (!user) throw new Error('User unavailable');
    if (action === 'grant') {
      const encrypted = encryptTotp(
        process.env.ADMIN_PROVISION_TOTP_SECRET ?? '',
        user.id,
        encryptionKey(),
      );
      const step = new TotpSecondFactor().verify(
        encrypted,
        user.id,
        process.env.ADMIN_PROVISION_TOTP_CODE ?? '',
        -1,
      );
      await tx
        .insert(adminAccounts)
        .values({
          userId,
          totpEncrypted: encrypted,
          lastTotpStep: step,
          ...grants,
        })
        .onConflictDoUpdate({
          target: adminAccounts.userId,
          set: {
            enabled: true,
            totpEncrypted: encrypted,
            lastTotpStep: step,
            ...grants,
            updatedAt: sql`now()`,
          },
        });
    } else {
      await protectLastSuperAdmin(tx, userId);
      const rows = await tx
        .update(adminAccounts)
        .set({ enabled: false, updatedAt: sql`now()` })
        .where(eq(adminAccounts.userId, userId))
        .returning({ id: adminAccounts.userId });
      if (!rows.length) throw new Error('Admin unavailable');
    }
    await tx
      .update(adminSessions)
      .set({ revokedAt: sql`now()` })
      .where(
        and(eq(adminSessions.userId, userId), isNull(adminSessions.revokedAt)),
      );
    await appendAudit(tx, {
      actor: 'OPERATOR:' + operator,
      action: action === 'grant' ? 'ADMIN_PROVISION' : 'ADMIN_REVOKE',
      resource: 'user',
      resourceId: userId,
      result: 'SUCCESS',
    });
  });
  console.log(JSON.stringify({ event: 'admin_provision_completed' }));
} catch {
  console.error(
    JSON.stringify({
      event: 'admin_provision_failed',
      message: 'Check operator inputs, enrollment proof and database access',
    }),
  );
  process.exitCode = 1;
} finally {
  await db?.onApplicationShutdown();
}
