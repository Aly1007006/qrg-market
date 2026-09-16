import { Inject, Injectable } from '@nestjs/common';
import { Database, type Transaction } from '../database.js';
import { auditLogs } from '../db/schema.js';
export type AuditEvent = Pick<
  typeof auditLogs.$inferInsert,
  | 'actor'
  | 'action'
  | 'resource'
  | 'resourceId'
  | 'result'
  | 'reason'
  | 'requestId'
>;
export async function appendAudit(tx: Transaction, event: AuditEvent) {
  await tx.insert(auditLogs).values(event);
}
@Injectable()
export class AuditLog {
  constructor(@Inject(Database) private readonly db: Database) {}
  async append(event: AuditEvent) {
    await this.db.client.insert(auditLogs).values(event);
  }
}
