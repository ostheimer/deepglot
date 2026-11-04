import assert from "node:assert/strict";
import test from "node:test";
import type { PrismaClient } from "@prisma/client";
import { listAuditEvents, parseAuditFilters } from "@/lib/audit-query";

test("activity filters retain and validate an older-events cursor", () => {
  assert.equal(parseAuditFilters(new URLSearchParams("after=event-006")).afterId, "event-006");
  assert.throws(() => parseAuditFilters(new URLSearchParams("after=other%2Fevent")));
});

test("activity pagination reaches events beyond the first 100 on one day", async () => {
  const createdAt = new Date("2026-10-09T12:00:00.000Z");
  const rows = Array.from({ length: 105 }, (_, index) => ({
    id: `event-${String(105 - index).padStart(3, "0")}`,
    organizationId: "workspace-a",
    createdAt,
    action: "translation.machine_saved",
    category: "translation",
    actorUserId: null,
    projectIdSnapshot: null,
    metadata: {},
    project: null,
    actor: null,
  }));
  const database = {
    organizationMember: { findUnique: async () => ({ role: "OWNER" }) },
    auditEvent: {
      findFirst: async ({ where }: { where: { id: string; organizationId: string } }) =>
        rows.find((row) => row.id === where.id && row.organizationId === where.organizationId) ?? null,
      findMany: async ({ where, take }: { where: { organizationId: string;
        OR?: Array<{ createdAt: Date | { lt: Date }; id?: { lt: string } }> }; take: number }) =>
        rows.filter((row) => row.organizationId === where.organizationId &&
          (!where.OR || where.OR.some((part) => part.createdAt instanceof Date
            ? row.createdAt.getTime() === part.createdAt.getTime() && row.id < (part.id?.lt ?? "")
            : row.createdAt < part.createdAt.lt))).slice(0, take),
    },
  } as unknown as PrismaClient;

  const first = await listAuditEvents(database, { organizationId: "workspace-a", readerUserId: "owner",
    filters: {}, limit: 101 });
  assert.equal(first?.length, 101);
  const second = await listAuditEvents(database, { organizationId: "workspace-a", readerUserId: "owner",
    filters: { afterId: first![99].id }, limit: 101 });
  assert.equal(second?.length, 5);
  assert.equal(new Set([...first!.slice(0, 100), ...second!].map((row) => row.id)).size, 105);
});
