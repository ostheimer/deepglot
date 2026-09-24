import assert from "node:assert/strict";
import test from "node:test";
import { resolveDatabaseUrl } from "@/lib/database-url";
import { updateProjectTranslationsBulkWorkflow, type BulkWorkflowItem } from "@/lib/translation-bulk-workflow";
import { TranslationWorkflowError, type TranslationWorkflowActor } from "@/lib/translation-workflow";

test("PostgreSQL bulk workflow commits only an authorized, current full selection", {
  skip: resolveDatabaseUrl() ? false : "requires a prepared PostgreSQL database",
}, async () => {
  const { db } = await import("@/lib/db");
  const suffix = crypto.randomUUID();
  const org = await db.organization.create({ data: { name: `Bulk ${suffix}`, slug: `bulk-${suffix}` } });
  const foreignOrg = await db.organization.create({ data: { name: `Foreign bulk ${suffix}`, slug: `foreign-bulk-${suffix}` } });
  try {
    const project = await db.project.create({
      data: {
        name: "Bulk workflow", domain: `bulk-${suffix}.example.test`, originalLang: "de",
        organizationId: org.id, languages: { create: [{ langCode: "en" }, { langCode: "fr" }] },
      },
    });
    const foreignProject = await db.project.create({
      data: {
        name: "Foreign bulk", domain: `foreign-bulk-${suffix}.example.test`, originalLang: "de",
        organizationId: foreignOrg.id, languages: { create: [{ langCode: "en" }] },
      },
    });
    const enMember = await db.projectMember.create({
      data: { projectId: project.id, email: `en-${suffix}@example.test`, role: "TRANSLATOR", langCode: "en" },
    });
    const frMember = await db.projectMember.create({
      data: { projectId: project.id, email: `fr-${suffix}@example.test`, role: "TRANSLATOR", langCode: "fr" },
    });
    const foreignMember = await db.projectMember.create({
      data: { projectId: foreignProject.id, email: `foreign-${suffix}@example.test`, role: "TRANSLATOR", langCode: "en" },
    });
    async function segment(projectId: string, langTo: string, key: string) {
      return db.translation.create({
        data: {
          projectId, originalHash: `${key}-${suffix}`, originalText: key,
          translatedText: key, langFrom: "de", langTo, source: "MOCK",
        },
      });
    }
    const a = await segment(project.id, "en", "a");
    const b = await segment(project.id, "en", "b");
    const fr = await segment(project.id, "fr", "fr");
    const foreign = await segment(foreignProject.id, "en", "foreign");
    const manager: TranslationWorkflowActor = { canManage: true, projectMemberId: null, langCode: null };
    const translator: TranslationWorkflowActor = { canManage: false, projectMemberId: enMember.id, langCode: "en" };
    const snapshot = async (...ids: string[]): Promise<BulkWorkflowItem[]> => {
      const rows = await db.translation.findMany({ where: { id: { in: ids } } });
      return ids.map((id) => {
        const row = rows.find((candidate) => candidate.id === id)!;
        return {
          id, expectedStatus: row.workflowStatus,
          expectedAssignedToId: row.assignedToId, expectedUpdatedAt: row.updatedAt,
        };
      });
    };
    const run = (items: BulkWorkflowItem[], action: Parameters<typeof updateProjectTranslationsBulkWorkflow>[0]["action"], actor = manager) =>
      updateProjectTranslationsBulkWorkflow({ projectId: project.id, items, action, actor });
    const fails = async (items: BulkWorkflowItem[], action: Parameters<typeof run>[1], actor: TranslationWorkflowActor, code: string) =>
      assert.rejects(run(items, action, actor),
        (error) => error instanceof TranslationWorkflowError && error.code === code);

    assert.deepEqual(await run(await snapshot(a.id, b.id), { kind: "assign", assignedToId: enMember.id }), { updated: 2 });
    assert.equal((await db.translation.findUniqueOrThrow({ where: { id: a.id } })).workflowStatus, "ASSIGNED");
    assert.equal((await db.translation.findUniqueOrThrow({ where: { id: b.id } })).assignedToId, enMember.id);
    await run(await snapshot(fr.id), { kind: "assign", assignedToId: frMember.id });

    const beforeForeign = await snapshot(a.id, foreign.id);
    await fails(beforeForeign, { kind: "submit" }, translator, "NOT_FOUND");
    assert.equal((await db.translation.findUniqueOrThrow({ where: { id: a.id } })).workflowStatus, "ASSIGNED");
    await fails(await snapshot(a.id, fr.id), { kind: "submit" }, translator, "FORBIDDEN");
    assert.equal((await db.translation.findUniqueOrThrow({ where: { id: a.id } })).workflowStatus, "ASSIGNED");
    await fails(await snapshot(a.id, b.id), { kind: "assign", assignedToId: foreignMember.id }, manager, "INVALID_ASSIGNEE");
    assert.equal((await db.translation.findUniqueOrThrow({ where: { id: a.id } })).assignedToId, enMember.id);

    const stale = await snapshot(a.id, b.id);
    await db.translation.update({ where: { id: b.id }, data: { translatedText: "changed" } });
    await fails(stale, { kind: "submit" }, translator, "STALE_UPDATE");
    assert.equal((await db.translation.findUniqueOrThrow({ where: { id: a.id } })).workflowStatus, "ASSIGNED");
    assert.deepEqual(await run(await snapshot(a.id, b.id), { kind: "submit" }, translator), { updated: 2 });
    assert.deepEqual(await run(await snapshot(a.id, b.id), { kind: "approve" }), { updated: 2 });
    for (const id of [a.id, b.id]) {
      assert.equal((await db.translation.findUniqueOrThrow({ where: { id } })).workflowStatus, "APPROVED");
    }
    await fails(await snapshot(a.id, a.id), { kind: "reopen" }, manager, "INVALID_PAYLOAD");
    await fails(await snapshot(a.id, b.id), { kind: "unassign" }, translator, "FORBIDDEN");
    const owner = await db.user.create({ data: { email: `bulk-owner-${suffix}@example.test` } });
    const ownerMembership = await db.organizationMember.create({
      data: { organizationId: org.id, userId: owner.id, role: "OWNER" },
    });
    await db.organizationMember.delete({ where: { id: ownerMembership.id } });
    await assert.rejects(updateProjectTranslationsBulkWorkflow({
      projectId: project.id, userId: owner.id, actor: manager,
      items: await snapshot(a.id, b.id), action: { kind: "reopen" },
    }), (error) => error instanceof TranslationWorkflowError && error.code === "FORBIDDEN");
    assert.equal((await db.translation.findUniqueOrThrow({ where: { id: a.id } })).workflowStatus, "APPROVED");
    await db.user.delete({ where: { id: owner.id } });
  } finally {
    await db.organization.delete({ where: { id: org.id } });
    await db.organization.delete({ where: { id: foreignOrg.id } });
    await db.$disconnect();
  }
});
