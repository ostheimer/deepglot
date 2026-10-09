import assert from "node:assert/strict";
import test from "node:test";
import { resolveDatabaseUrl } from "@/lib/database-url";
import { previewWorkspaceReplacement, applyWorkspaceReplacement } from "@/lib/translation-search-replace-workflow";
import { TranslationWorkflowError } from "@/lib/translation-workflow";

test("selected replacement preview is atomic, permission-fresh and records manual history", {
  skip: resolveDatabaseUrl() ? false : "requires isolated PostgreSQL",
}, async () => {
  const { db } = await import("@/lib/db");
  const suffix = crypto.randomUUID();
  const organization = await db.organization.create({ data: { name: "Replace test", slug: `replace-${suffix}` } });
  try {
    const user = await db.user.create({ data: { email: `replace-${suffix}@example.test` } });
    const membership = await db.organizationMember.create({ data: { organizationId: organization.id, userId: user.id, role: "OWNER" } });
    const project = await db.project.create({ data: {
      organizationId: organization.id, name: "Replace", domain: `replace-${suffix}.test`,
      originalLang: "de", languages: { create: { langCode: "en" } },
    } });
    const create = (key: string, wordType = 1) => db.translation.create({ data: {
      projectId: project.id, originalHash: `${key}-${suffix}`, originalText: "Hallo {name}",
      translatedText: "Hello {name}", langFrom: "de", langTo: "en", source: "MOCK",
      typeObservations: { create: { wordType } },
    } });
    const [a, b, media] = await Promise.all([create("a"), create("b"), create("media", 6)]);
    const actor = { canManage: true, projectMemberId: null, langCode: null };
    const selected = async (...ids: string[]) => {
      const rows = await db.translation.findMany({ where: { id: { in: ids } } });
      return ids.map((id) => ({ id, expectedUpdatedAt: rows.find((row) => row.id === id)!.updatedAt }));
    };
    const request = { projectId: project.id, userId: user.id, actor, find: "Hello", replace: "Hi",
      items: await selected(a.id, b.id) };
    const preview = await previewWorkspaceReplacement(request);
    assert.equal(preview.items.length, 2);
    await db.translation.update({ where: { id: b.id }, data: { translatedText: "Hello again {name}" } });
    await assert.rejects(applyWorkspaceReplacement({ ...request, fingerprint: preview.fingerprint }),
      (error) => error instanceof TranslationWorkflowError && error.code === "STALE_UPDATE");
    assert.equal((await db.translation.findUniqueOrThrow({ where: { id: a.id } })).translatedText, "Hello {name}");
    const fresh = { ...request, items: await selected(a.id, b.id) };
    const currentPreview = await previewWorkspaceReplacement(fresh);
    assert.deepEqual(await applyWorkspaceReplacement({ ...fresh, fingerprint: currentPreview.fingerprint }), { updated: 2 });
    assert.equal(await db.urlCacheInvalidation.count({ where: { projectId: project.id } }), 2,
      "each replaced source digest must invalidate the WordPress transient");
    const changed = await db.translation.findUniqueOrThrow({ where: { id: a.id }, include: { contentRevisions: true } });
    assert.equal(changed.translatedText, "Hi {name}");
    assert.equal(changed.isManual, true);
    assert.equal(changed.contentRevisions.length, 1);
    assert.equal(changed.contentRevisions[0].actorUserId, user.id);
    await assert.rejects(previewWorkspaceReplacement({ ...request, items: await selected(media.id) }),
      (error) => error instanceof TranslationWorkflowError && error.code === "INVALID_TRANSITION");
    const reviewedRequest = { ...request, items: await selected(a.id), includeReviewed: true, find: "Hi", replace: "Hey" };
    const reviewedPreview = await previewWorkspaceReplacement(reviewedRequest);
    assert.equal(reviewedPreview.items[0].reviewed, true);
    await applyWorkspaceReplacement({ ...reviewedRequest, fingerprint: reviewedPreview.fingerprint });
    assert.equal((await db.translationContentRevision.count({ where: { translationId: a.id } })), 2);
    await db.translation.update({ where: { id: a.id }, data: { workflowStatus: "APPROVED" } });
    const approvedRequest = { ...request, items: await selected(a.id), includeReviewed: true,
      find: "Hey", replace: "Hi" };
    const approvedPreview = await previewWorkspaceReplacement(approvedRequest);
    assert.equal(approvedPreview.items[0].reviewed, true);
    assert.equal(approvedPreview.items[0].statusAfter, "machine");
    await applyWorkspaceReplacement({ ...approvedRequest, fingerprint: approvedPreview.fingerprint });
    assert.equal((await db.translation.findUniqueOrThrow({ where: { id: a.id } })).workflowStatus, "MACHINE");
    assert.equal(await db.translationContentRevision.count({ where: { translationId: a.id } }), 3);
    const revokedRequest = { ...request, items: await selected(b.id), includeReviewed: true, find: "Hi", replace: "Hey" };
    const revokedPreview = await previewWorkspaceReplacement(revokedRequest);
    await db.organizationMember.delete({ where: { id: membership.id } });
    await assert.rejects(applyWorkspaceReplacement({ ...revokedRequest, fingerprint: revokedPreview.fingerprint }),
      (error) => error instanceof TranslationWorkflowError && error.code === "FORBIDDEN");
  } finally {
    await db.organization.delete({ where: { id: organization.id } });
    await db.$disconnect();
  }
});
