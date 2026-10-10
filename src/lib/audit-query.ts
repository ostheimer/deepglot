import type { PrismaClient } from "@prisma/client";
import { AUDIT_CATEGORIES, type AuditCategory } from "@/lib/audit-events";

export type AuditFilters = {
  from?: Date;
  toExclusive?: Date;
  actorUserId?: string;
  projectId?: string;
  category?: AuditCategory;
};

const viennaParts = new Intl.DateTimeFormat("en-GB", {
  timeZone: "Europe/Vienna", year: "numeric", month: "2-digit", day: "2-digit",
  hour: "2-digit", minute: "2-digit", hourCycle: "h23",
});

function viennaDayStart(day: string) {
  const [year, month, date] = day.split("-").map(Number);
  const utcMidnight = Date.UTC(year, month - 1, date);
  const parts = Object.fromEntries(viennaParts.formatToParts(new Date(utcMidnight))
    .filter((part) => part.type !== "literal").map((part) => [part.type, Number(part.value)]));
  const offset = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute) - utcMidnight;
  return new Date(utcMidnight - offset);
}

function nextCalendarDay(day: string) {
  const [year, month, date] = day.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, date + 1)).toISOString().slice(0, 10);
}

export function parseAuditFilters(params: URLSearchParams): AuditFilters {
  const date = (key: string) => {
    const value = params.get(key);
    if (!value) return undefined;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new Error("Invalid audit date");
    const parsed = new Date(`${value}T00:00:00.000Z`);
    if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value) {
      throw new Error("Invalid audit date");
    }
    return value;
  };
  const fromDay = date("from");
  const toDay = date("to");
  const from = fromDay ? viennaDayStart(fromDay) : undefined;
  const toExclusive = toDay ? viennaDayStart(nextCalendarDay(toDay)) : undefined;
  if (fromDay && toDay && fromDay > toDay) throw new Error("Invalid audit date range");
  const category = params.get("category") || undefined;
  if (category && !AUDIT_CATEGORIES.includes(category as AuditCategory)) {
    throw new Error("Invalid audit category");
  }
  const id = (key: string) => {
    const value = params.get(key);
    if (!value) return undefined;
    if (!/^[a-zA-Z0-9_-]{1,80}$/.test(value)) throw new Error("Invalid audit filter");
    return value;
  };
  return { from, toExclusive, category: category as AuditCategory | undefined,
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
  const { from, toExclusive, actorUserId, projectId, category } = input.filters;
  return database.auditEvent.findMany({
    where: {
      organizationId: input.organizationId,
      ...(from || toExclusive ? { createdAt: {
        ...(from ? { gte: from } : {}),
        ...(toExclusive ? { lt: toExclusive } : {}),
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
