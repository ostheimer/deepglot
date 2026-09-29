import assert from "node:assert/strict";
import { test } from "node:test";
import { resolveDatabaseUrl } from "@/lib/database-url";
import { listTranslationHistory } from "@/lib/translation-history";
import { updateProjectTranslationContent, type TranslationWorkflowActor } from "@/lib/translation-workflow";

const manager: TranslationWorkflowActor = { canManage: true, projectMemberId: null, langCode: null };

test("workspace history is atomic, scoped, cursor-paginated and survives actor deletion", {
  skip: resolveDatabaseUrl() ? false : "requires prepared PostgreSQL",
}, async () => {
  const { db } = await import("@/lib/db");
  const suffix = crypto.randomUUID();
  const user = await db.user.create({ data: { email: `history-${suffix}@example.test`, name: "History reviewer" } });
  const organization = await db.organization.create({ data: { name: "History fixtures", slug: `history-${suffix}` } });
  const project = await db.project.create({ data: {
    organizationId: organization.id, name: "History", domain: `${suffix}.example.test`, originalLang: "de",
    languages: { create: [{ langCode: "en" }, { langCode: "fr" }] },
  } });
  const member = await db.projectMember.create({ data: { projectId: project.id, userId: user.id, email: user.email, role: "TRANSLATOR", langCode: "en" } });
  const translation = await db.translation.create({ data: {
    projectId: project.id, originalHash: suffix, originalText: "Fixture", translatedText: "A", langFrom: "de", langTo: "en", assignedToId: member.id, workflowStatus: "APPROVED", wordCount: 1,
  } });
  const input = { projectId: project.id, translationId: translation.id, actor: manager, actorUserId: user.id };
  try {
    assert.deepEqual((await listTranslationHistory(input)).items, []);
    const b = await updateProjectTranslationContent({ ...input, translatedText: "B", expectedUpdatedAt: translation.updatedAt });
    const c = await updateProjectTranslationContent({ ...input, translatedText: "C", expectedUpdatedAt: b.updatedAt });
    const history = await listTranslationHistory({ ...input, pageSize: 1 });
    assert.equal(history.items.length, 1);
    assert.equal(history.items[0].beforeText, "B");
    assert.equal(history.items[0].afterText, "C");
    assert.equal(history.items[0].actor?.name, user.name);
    const second = await listTranslationHistory({ ...input, pageSize: 1, cursor: history.nextCursor! });
    assert.equal(second.items[0].beforeText, "A");
    assert.equal(second.items[0].afterText, "B");
    assert.equal(second.nextCursor, null);
    await updateProjectTranslationContent({ ...input, translatedText: "C", expectedUpdatedAt: c.updatedAt });
    await assert.rejects(updateProjectTranslationContent({ ...input, translatedText: "stale", expectedUpdatedAt: translation.updatedAt }), { code: "STALE_UPDATE" });
    await assert.rejects(updateProjectTranslationContent({ ...input, actor: { ...manager, canManage: false, projectMemberId: "other" }, translatedText: "denied", expectedUpdatedAt: c.updatedAt }), { code: "FORBIDDEN" });
    const beforeRollback = await db.translationBatchLog.count({ where: { projectId: project.id } });
    await assert.rejects(updateProjectTranslationContent({ ...input, actorUserId: "missing-user", translatedText: "rollback", expectedUpdatedAt: c.updatedAt }));
    assert.equal((await db.translation.findUniqueOrThrow({ where: { id: translation.id } })).translatedText, "C");
    assert.equal(await db.translationBatchLog.count({ where: { projectId: project.id } }), beforeRollback);
    assert.equal(await db.translationContentRevision.count({ where: { translationId: translation.id } }), 2);
    await assert.rejects(listTranslationHistory({ ...input, projectId: "foreign-project" }), { code: "NOT_FOUND" });
    await assert.rejects(listTranslationHistory({ ...input, actor: { ...manager, canManage: false, langCode: "fr" } }), { code: "FORBIDDEN" });
    assert.equal((await listTranslationHistory({ ...input, actor: { canManage: false, projectMemberId: member.id, langCode: "en" } })).items.length, 2);
    await assert.rejects(listTranslationHistory({ ...input, cursor: "foreign-revision" }), { code: "INVALID_PAYLOAD" });
    // Concurrent CAS attempts: only the committed version is recorded.
    const race = await Promise.allSettled(["D", "E"].map((translatedText) => updateProjectTranslationContent({ ...input, translatedText, expectedUpdatedAt: c.updatedAt })));
    assert.equal(race.filter((result) => result.status === "fulfilled").length, 1);
    const newest = (await listTranslationHistory(input)).items[0];
    assert.equal(newest.beforeText, "C");
    assert.equal(newest.afterText, (await db.translation.findUniqueOrThrow({ where: { id: translation.id } })).translatedText);
    assert.equal(await db.translationContentRevision.count({ where: { translationId: translation.id } }), 3);
    // Equal timestamps still produce deterministic, non-overlapping pages.
    const sameTime = new Date("2040-01-01T00:00:00Z");
    await db.translationContentRevision.createMany({ data: ["a", "b", "c"].map((key) => ({ id: `${suffix}-${key}`, translationId: translation.id, beforeText: key, afterText: key, createdAt: sameTime })) });
    const tied = await listTranslationHistory({ ...input, pageSize: 2 });
    assert.deepEqual(tied.items.map((row) => row.beforeText), ["c", "b"]);
    assert.equal((await listTranslationHistory({ ...input, pageSize: 2, cursor: tied.nextCursor! })).items[0].beforeText, "a");
    await db.user.delete({ where: { id: user.id } });
    assert.equal((await listTranslationHistory(input)).items.find((row) => row.afterText === "B")?.actor, null);
    await db.translation.delete({ where: { id: translation.id } });
    assert.equal(await db.translationContentRevision.count({ where: { translationId: translation.id } }), 0);
  } finally {
    await db.organization.delete({ where: { id: organization.id } });
    await db.user.deleteMany({ where: { id: user.id } });
    await db.$disconnect();
  }
});
