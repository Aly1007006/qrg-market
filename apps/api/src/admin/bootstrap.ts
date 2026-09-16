import { eq, sql } from 'drizzle-orm';
import { Database } from '../database.js';
import { adminAccounts, users } from '../db/schema.js';
import { Passwords } from '../auth/passwords.js';
import { appendAudit } from './audit.js';

export async function bootstrapAdmin(
  db: Database,
  email: string,
  password: string,
) {
  if (
    email !== email.trim().toLowerCase() ||
    !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ||
    email.length > 254 ||
    password.length < 12 ||
    password.length > 128
  )
    throw new Error('Invalid bootstrap inputs');
  return db.client.transaction(async (tx) => {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(71624802)`);
    const [existing] = await tx
      .select({ id: users.id })
      .from(users)
      .where(eq(users.email, email));
    if (existing) {
      const [account] = await tx
        .select({ role: adminAccounts.role })
        .from(adminAccounts)
        .where(eq(adminAccounts.userId, existing.id));
      if (account?.role === 'SUPER_ADMIN')
        return { created: false, userId: existing.id };
      throw new Error(
        'Existing account requires an explicit administrator management action',
      );
    }
    const [superAdmin] = await tx
      .select({ id: adminAccounts.userId })
      .from(adminAccounts)
      .where(eq(adminAccounts.role, 'SUPER_ADMIN'));
    if (superAdmin) throw new Error('Initial administrator already exists');
    const [user] = await tx
      .insert(users)
      .values({ email, passwordHash: await new Passwords().hash(password) })
      .returning({ id: users.id });
    if (!user) throw new Error('Bootstrap insert failed');
    await tx.insert(adminAccounts).values({
      userId: user.id,
      role: 'SUPER_ADMIN',
      mustChangePassword: true,
    });
    await appendAudit(tx, {
      actor: 'OPERATOR:bootstrap',
      action: 'ADMIN_CREATED',
      resource: 'user',
      resourceId: user.id,
      result: 'SUCCESS',
    });
    return { created: true, userId: user.id };
  });
}
