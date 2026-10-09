import assert from "node:assert/strict";
import { after, test } from "node:test";
import { resolveDatabaseUrl } from "@/lib/database-url";
import { appendProjectAuditEvent, appendWorkspaceAuditEvent } from "@/lib/audit-events";
import { listAuditEvents } from "@/lib/audit-query";
import { deleteExpiredAuditEvents } from "@/lib/audit-retention";
import { addProjectTargetLanguages } from "@/lib/project-language-mutations";

const url = resolveDatabaseUrl();
const localOnly = url && ["localhost", "127.0.0.1"].includes(new URL(url).hostname);
const skip = localOnly ? false : "requires an isolated local PostgreSQL database";
const orgIds: string[] = [];
const userIds: string[] = [];

test("committed audit events are tenant-scoped, filtered and retained after project deletion", { skip }, async () => {
  const { db } = await import("@/lib/db");
  const suffix = crypto.randomUUID();
  const owner = await db.user.create({ data: { email: `audit-owner-${suffix}@example.test` } });
  const foreign = await db.user.create({ data: { email: `audit-foreign-${suffix}@example.test` } });
  userIds.push(owner.id, foreign.id);
  const org = await db.organization.create({ data: { name: "Audit fixture", slug: `audit-${suffix}` } });
  const other = await db.organization.create({ data: { name: "Other fixture", slug: `other-audit-${suffix}` } });
  orgIds.push(org.id, other.id);
  await db.organizationMember.createMany({ data: [
    { organizationId: org.id, userId: owner.id, role: "OWNER" },
    { organizationId: other.id, userId: foreign.id, role: "OWNER" },
  ] });
  const project = await db.project.create({ data: { organizationId: org.id, name: "Audit", domain: `${suffix}.example.test` } });
  const foreignProject = await db.project.create({ data: { organizationId: other.id, name: "Other", domain: `other-${suffix}.example.test` } });

  await db.$transaction(async (tx) => {
    await tx.project.update({ where: { id: project.id }, data: { name: "Updated audit project" } });
    await appendProjectAuditEvent(tx, { projectId: project.id, actorUserId: owner.id,
      action: "project.updated", category: "project", metadata: { affectedId: project.id } });
    await appendProjectAuditEvent(tx, { projectId: foreignProject.id, actorUserId: foreign.id,
      action: "project.updated", category: "project" });
  });
  await assert.rejects(db.$transaction(async (tx) => {
    await tx.project.update({ where: { id: project.id }, data: { name: "Rolled back" } });
    await appendWorkspaceAuditEvent(tx, { organizationId: org.id, actorUserId: owner.id,
      action: "workspace.failed", category: "workspace" });
    throw new Error("rollback");
  }));
  assert.equal(await db.auditEvent.count({ where: { organizationId: org.id } }), 1);
  assert.equal((await db.project.findUniqueOrThrow({ where: { id: project.id } })).name, "Updated audit project");
  const visible = await listAuditEvents(db, { organizationId: org.id, readerUserId: owner.id,
    filters: { projectId: project.id, category: "project", actorUserId: owner.id } });
  assert.equal(visible?.length, 1);
  assert.equal(await listAuditEvents(db, { organizationId: org.id, readerUserId: foreign.id, filters: {} }), null);
  await db.project.delete({ where: { id: project.id } });
  const retained = await db.auditEvent.findFirstOrThrow({ where: { organizationId: org.id } });
  assert.equal(retained.projectId, null);
  assert.equal(retained.projectIdSnapshot, project.id);

  const expired = await db.auditEvent.create({ data: {
    organizationId: org.id, action: "workspace.old", category: "workspace",
    createdAt: new Date("2020-01-01T00:00:00.000Z"),
  } });
  const cleanup = await deleteExpiredAuditEvents(db, new Date("2026-10-09T00:00:00.000Z"));
  assert.equal(cleanup.count, 1);
  assert.equal(await db.auditEvent.findUnique({ where: { id: expired.id } }), null);
  assert.equal(await db.auditEvent.count({ where: { organizationId: org.id } }), 1);
});

test("a real language mutation commits its audit row in the same workspace", { skip }, async () => {
  const { db } = await import("@/lib/db");
  const suffix = crypto.randomUUID();
  const actor = await db.user.create({ data: { email: `language-audit-${suffix}@example.test` } });
  userIds.push(actor.id);
  const organization = await db.organization.create({ data: { name: "Language audit", slug: `language-audit-${suffix}` } });
  orgIds.push(organization.id);
  await db.organizationMember.create({ data: { organizationId: organization.id, userId: actor.id, role: "OWNER" } });
  const project = await db.project.create({ data: { organizationId: organization.id, name: "Language audit", domain: `language-${suffix}.example.test` } });

  assert.deepEqual(await addProjectTargetLanguages(db, { projectId: project.id, languages: ["fr"], actorUserId: actor.id }), { kind: "updated" });
  const events = await listAuditEvents(db, { organizationId: organization.id, readerUserId: actor.id,
    filters: { projectId: project.id, actorUserId: actor.id } });
  assert.equal(events?.length, 1);
  assert.equal(events?.[0].action, "project.languages_added");
  assert.equal(await db.projectLanguage.count({ where: { projectId: project.id, langCode: "fr" } }), 1);
});

after(async () => {
  if (!localOnly) return;
  const { db } = await import("@/lib/db");
  await db.organization.deleteMany({ where: { id: { in: orgIds } } });
  await db.user.deleteMany({ where: { id: { in: userIds } } });
  await db.$disconnect();
});
