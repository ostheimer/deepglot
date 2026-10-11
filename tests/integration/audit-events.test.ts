import assert from "node:assert/strict";
import { after, test } from "node:test";
import { resolveDatabaseUrl } from "@/lib/database-url";
import { appendProjectAuditEvent, appendWorkspaceAuditEvent } from "@/lib/audit-events";
import { listAuditEvents } from "@/lib/audit-query";
import { deleteExpiredAuditEvents } from "@/lib/audit-retention";
import { addProjectTargetLanguages, updateProjectTargetLanguage } from "@/lib/project-language-mutations";

const url = resolveDatabaseUrl();
const localOnly = url && ["localhost", "127.0.0.1"].includes(new URL(url).hostname);
const skip = localOnly ? false : "requires an isolated local PostgreSQL database";
const orgIds: string[] = [];
const userIds: string[] = [];

test("committed audit events are tenant-scoped, filtered and retained after project deletion", { skip }, async () => {
  const { db } = await import("@/lib/db");
  const suffix = crypto.randomUUID();
  const owner = await db.user.create({ data: { email: `audit-owner-${suffix}@example.test` } });
  const reader = await db.user.create({ data: { email: `audit-reader-${suffix}@example.test` } });
  const foreign = await db.user.create({ data: { email: `audit-foreign-${suffix}@example.test` } });
  userIds.push(owner.id, reader.id, foreign.id);
  const org = await db.organization.create({ data: { name: "Audit fixture", slug: `audit-${suffix}` } });
  const other = await db.organization.create({ data: { name: "Other fixture", slug: `other-audit-${suffix}` } });
  orgIds.push(org.id, other.id);
  await db.organizationMember.createMany({ data: [
    { organizationId: org.id, userId: owner.id, role: "OWNER" },
    { organizationId: org.id, userId: reader.id, role: "ADMIN" },
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

  await db.organizationMember.delete({ where: { userId_organizationId: { userId: owner.id, organizationId: org.id } } });
  await db.user.update({ where: { id: owner.id }, data: { name: "Later private name", email: `changed-${suffix}@example.test` } });
  const formerActorEvents = await listAuditEvents(db, { organizationId: org.id, readerUserId: reader.id,
    filters: { actorUserId: owner.id } });
  assert.equal(formerActorEvents?.[0].actor, null);
  assert.equal(formerActorEvents?.[0].actorUserId, owner.id);

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
  assert.equal(await updateProjectTargetLanguage(db, { projectId: project.id, langCode: "fr", isVisible: false, actorUserId: actor.id }), true);
  assert.equal(await updateProjectTargetLanguage(db, { projectId: project.id, langCode: "fr", isVisible: false, actorUserId: actor.id }), true);
  const events = await listAuditEvents(db, { organizationId: organization.id, readerUserId: actor.id,
    filters: { projectId: project.id, actorUserId: actor.id } });
  assert.equal(events?.length, 2);
  assert.deepEqual(new Set(events?.map((event) => event.action)), new Set(["project.languages_added", "project.language_updated"]));
  assert.equal(await db.projectLanguage.count({ where: { projectId: project.id, langCode: "fr" } }), 1);
});

test("project-only actors remain named only while their project belongs to this workspace", { skip }, async () => {
  const { db } = await import("@/lib/db");
  const suffix = crypto.randomUUID();
  const reader = await db.user.create({ data: { email: `project-reader-${suffix}@example.test` } });
  const actor = await db.user.create({ data: { name: "Current translator", email: `project-actor-${suffix}@example.test` } });
  userIds.push(reader.id, actor.id);
  const organization = await db.organization.create({ data: { name: "Project actor", slug: `project-actor-${suffix}` } });
  const destination = await db.organization.create({ data: { name: "Destination", slug: `project-destination-${suffix}` } });
  orgIds.push(organization.id, destination.id);
  await db.organizationMember.create({ data: { organizationId: organization.id, userId: reader.id, role: "OWNER" } });
  const project = await db.project.create({ data: { organizationId: organization.id, name: "Actor project", domain: `actor-${suffix}.example.test` } });
  await db.projectMember.create({ data: { projectId: project.id, userId: actor.id, email: actor.email, role: "TRANSLATOR" } });
  await appendProjectAuditEvent(db, { projectId: project.id, actorUserId: actor.id,
    action: "translation.manual_updated", category: "translation" });

  const current = await listAuditEvents(db, { organizationId: organization.id, readerUserId: reader.id, filters: {} });
  assert.equal(current?.[0].actor?.name, "Current translator");

  await db.auditEvent.updateMany({ where: { organizationId: organization.id, projectId: project.id }, data: { projectId: null } });
  await db.project.update({ where: { id: project.id }, data: { organizationId: destination.id } });
  const transferred = await listAuditEvents(db, { organizationId: organization.id, readerUserId: reader.id, filters: {} });
  assert.equal(transferred?.[0].actor, null);
  assert.equal(transferred?.[0].actorUserId, actor.id);
});

after(async () => {
  if (!localOnly) return;
  const { db } = await import("@/lib/db");
  await db.organization.deleteMany({ where: { id: { in: orgIds } } });
  await db.user.deleteMany({ where: { id: { in: userIds } } });
  await db.$disconnect();
});
