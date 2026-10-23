import type { PrismaClient } from "@prisma/client";

export const AUDIT_RETENTION_DAYS = 365;

export function auditRetentionCutoff(now = new Date()) {
  return new Date(now.getTime() - AUDIT_RETENTION_DAYS * 86_400_000);
}

export async function deleteExpiredAuditEvents(database: Pick<PrismaClient, "auditEvent">, now = new Date()) {
  return database.auditEvent.deleteMany({ where: { createdAt: { lt: auditRetentionCutoff(now) } } });
}
