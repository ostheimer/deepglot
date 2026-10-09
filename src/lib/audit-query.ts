import type { PrismaClient } from "@prisma/client";
import { AUDIT_CATEGORIES, type AuditCategory } from "@/lib/audit-events";

export type AuditFilters = {
  from?: Date;
  to?: Date;
  actorUserId?: string;
  projectId?: string;
  category?: AuditCategory;
};

export function parseAuditFilters(params: URLSearchParams): AuditFilters {
  const date = (key: string) => {
    const value = params.get(key);
    if (!value) return undefined;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new Error("Invalid audit date");
    const parsed = new Date(`${value}T00:00:00.000Z`);
    if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value) {
      throw new Error("Invalid audit date");
    }
    return parsed;
  };
  const from = date("from");
  const to = date("to");
  if (from && to && from > to) throw new Error("Invalid audit date range");
  const category = params.get("category");
  if (category && !AUDIT_CATEGORIES.includes(category as AuditCategory)) {
    throw new Error("Invalid audit category");
  }
  const id = (key: string) => {
    const value = params.get(key);
    if (!value) return undefined;
    if (!/^[a-zA-Z0-9_-]{1,80}$/.test(value)) throw new Error("Invalid audit filter");
    return value;
  };
  return { from, to, category: category as AuditCategory | undefined,
    actorUserId: id("actor"), projectId: id("project") };
}

export async function listAuditEvents(
  database: PrismaClient,
  input: { organizationId: string; readerUserId: string; filters: AuditFilters; limit?: number },
) {
  const membership = await database.organizationMember.findUnique({
    where: { userId_organizationId: { userId: input.readerUserId, organizationId: input.organizationId } },
    select: { role: true },
  });
  if (!membership || !["OWNER", "ADMIN"].includes(membership.role)) return null;
  const { from, to, actorUserId, projectId, category } = input.filters;
  return database.auditEvent.findMany({
    where: {
      organizationId: input.organizationId,
      ...(from || to ? { createdAt: {
        ...(from ? { gte: from } : {}),
        ...(to ? { lt: new Date(to.getTime() + 86_400_000) } : {}),
      } } : {}),
      ...(actorUserId ? { actorUserId } : {}),
      ...(projectId ? { projectIdSnapshot: projectId } : {}),
      ...(category ? { category } : {}),
    },
    select: {
      id: true, createdAt: true, action: true, category: true,
      projectIdSnapshot: true, actorUserId: true, metadata: true,
      project: { select: { name: true } },
      actor: { select: { name: true, email: true } },
    },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: Math.min(Math.max(input.limit ?? 100, 1), 1_000),
  });
}
