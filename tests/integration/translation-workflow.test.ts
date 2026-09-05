import assert from "node:assert/strict";
import { after, test } from "node:test";

import { resolveDatabaseUrl } from "@/lib/database-url";
import {
  TranslationWorkflowError,
  listProjectTranslationWorkflow,
  deleteProjectTranslation,
  resetProjectMemberWorkflowAssignments,
  updateProjectTranslationContent,
  updateProjectTranslationWorkflow,
  type TranslationWorkflowActor,
} from "@/lib/translation-workflow";

const databaseUrl = resolveDatabaseUrl();
const skipWithoutDatabase = databaseUrl
  ? false
  : "requires a prepared PostgreSQL database via DATABASE_URL or DEEPGLOT_DATABASE_URL";
const cleanupOrganizationIds = new Set<string>();

const manager: TranslationWorkflowActor = {
  canManage: true,
  projectMemberId: null,
  langCode: null,
};

test(
  "PostgreSQL persists tenant-safe assignment and review transitions",
  { skip: skipWithoutDatabase },
  async (testContext) => {
    const { db } = await import("@/lib/db");
    const suffix = crypto.randomUUID();
    const user = await db.user.create({
      data: { email: `reviewer-${suffix}@example.test`, name: "Reviewer" },
    });
    const organization = await db.organization.create({
      data: { name: `Workflow ${suffix}`, slug: `workflow-${suffix}` },
    });
    cleanupOrganizationIds.add(organization.id);
    const foreignOrganization = await db.organization.create({
      data: { name: `Foreign ${suffix}`, slug: `foreign-${suffix}` },
    });
    cleanupOrganizationIds.add(foreignOrganization.id);

    const project = await db.project.create({
      data: {
        name: "Workflow project",
        domain: `${suffix}.example.test`,
        originalLang: "de",
        organizationId: organization.id,
        languages: {
          create: [
            { langCode: "en" },
            { langCode: "fr" },
            { langCode: "it" },
          ],
        },
      },
    });
    const foreignProject = await db.project.create({
      data: {
        name: "Foreign project",
        domain: `foreign-${suffix}.example.test`,
        originalLang: "de",
        organizationId: foreignOrganization.id,
        languages: { create: [{ langCode: "en" }] },
      },
    });
    const reviewer = await db.projectMember.create({
      data: {
        projectId: project.id,
        userId: user.id,
        email: user.email,
        role: "TRANSLATOR",
        langCode: null,
      },
    });
    const foreignReviewer = await db.projectMember.create({
      data: {
        projectId: foreignProject.id,
        email: `foreign-${suffix}@example.test`,
        role: "TRANSLATOR",
        langCode: "en",
      },
    });
    await db.webhookEndpoint.create({
      data: {
        projectId: project.id,
        url: "https://example.test/deepglot-webhook",
        secret: `secret-${suffix}`,
        eventTypes: ["translation.manual_updated", "translation.deleted"],
      },
    });
    const translation = await db.translation.create({
      data: {
        projectId: project.id,
        originalHash: `hash-${suffix}`,
        originalText: "Ein zu prüfender Satz.",
        translatedText: "A sentence to review.",
        langFrom: "de",
        langTo: "en",
        source: "OPENAI",
        wordCount: 5,
      },
    });

    const manuallyEdited = await updateProjectTranslationContent({
      projectId: project.id,
      translationId: translation.id,
      actor: manager,
      translatedText: "An authoritative manual translation.",
      expectedUpdatedAt: translation.updatedAt,
    });
    assert.equal(
      manuallyEdited.translatedText,
      "An authoritative manual translation.",
    );
    assert.equal(manuallyEdited.isManual, true);
    assert.equal(manuallyEdited.source, "MANUAL");
    assert.equal(manuallyEdited.workflowStatus, "MACHINE");
    await testContext.test("records workspace edits for activity digests", async () => {
      assert.deepEqual(
        await db.translationBatchLog.findFirst({
          where: { projectId: project.id, provider: "manual" },
          select: {
            organizationId: true,
            langFrom: true,
            langTo: true,
            totalWords: true,
            manualWords: true,
            translatedWords: true,
          },
        }),
        {
          organizationId: organization.id,
          langFrom: "de",
          langTo: "en",
          totalWords: 5,
          manualWords: 5,
          translatedWords: 0,
        },
      );
    });
    assert.equal(
      await db.webhookDelivery.count({
        where: {
          projectId: project.id,
          eventType: "translation.manual_updated",
        },
      }),
      1,
    );

    await assert.rejects(
      updateProjectTranslationContent({
        projectId: project.id,
        translationId: translation.id,
        actor: manager,
        translatedText: "A stale overwrite.",
        expectedUpdatedAt: translation.updatedAt,
      }),
      (error) =>
        error instanceof TranslationWorkflowError &&
        error.code === "STALE_UPDATE",
    );

    const inactiveLanguageTranslation = await db.translation.create({
      data: {
        projectId: project.id,
        originalHash: `inactive-it-${suffix}`,
        originalText: "Eine inzwischen inaktive Sprache.",
        translatedText: "Una lingua ora inattiva.",
        langFrom: "de",
        langTo: "it",
        source: "OPENAI",
        wordCount: 4,
      },
    });
    await db.projectLanguage.updateMany({
      where: { projectId: project.id, langCode: "it" },
      data: { isActive: false },
    });
    await testContext.test(
      "rejects workspace edits after the target language is deactivated",
      async () => {
        await assert.rejects(
          updateProjectTranslationContent({
            projectId: project.id,
            translationId: inactiveLanguageTranslation.id,
            actor: manager,
            translatedText: "Questa modifica deve essere rifiutata.",
            expectedUpdatedAt: inactiveLanguageTranslation.updatedAt,
          }),
          (error) =>
            error instanceof TranslationWorkflowError &&
            error.code === "INVALID_LANGUAGE",
        );
        assert.equal(
          (
            await db.translation.findUniqueOrThrow({
              where: { id: inactiveLanguageTranslation.id },
              select: { translatedText: true },
            })
          ).translatedText,
          "Una lingua ora inattiva.",
        );
        assert.equal(
          await db.translationBatchLog.count({
            where: { projectId: project.id, provider: "manual" },
          }),
          1,
        );
        assert.equal(
          await db.webhookDelivery.count({
            where: {
              projectId: project.id,
              eventType: "translation.manual_updated",
            },
          }),
          1,
        );
      },
    );

    const assigned = await updateProjectTranslationWorkflow({
      projectId: project.id,
      translationId: translation.id,
      actor: manager,
      patch: { assignedToId: reviewer.id },
    });
    assert.equal(assigned.workflowStatus, "ASSIGNED");
    assert.equal(assigned.assignedToId, reviewer.id);

    const translator: TranslationWorkflowActor = {
      canManage: false,
      projectMemberId: reviewer.id,
      langCode: "en",
    };
    const editedByTranslator = await updateProjectTranslationContent({
      projectId: project.id,
      translationId: translation.id,
      actor: translator,
      translatedText: "The assigned translator's manual translation.",
      expectedUpdatedAt: assigned.updatedAt,
    });
    assert.equal(editedByTranslator.workflowStatus, "ASSIGNED");
    assert.equal(editedByTranslator.assignedToId, reviewer.id);
    const inReview = await updateProjectTranslationWorkflow({
      projectId: project.id,
      translationId: translation.id,
      actor: translator,
      patch: { status: "IN_REVIEW" },
    });
    assert.equal(inReview.workflowStatus, "IN_REVIEW");

    const approved = await updateProjectTranslationWorkflow({
      projectId: project.id,
      translationId: translation.id,
      actor: manager,
      patch: { status: "APPROVED" },
    });
    assert.equal(approved.workflowStatus, "APPROVED");

    const listing = await listProjectTranslationWorkflow({
      projectId: project.id,
      actor: translator,
      filters: { status: "APPROVED" },
    });
    assert.equal(listing.items.length, 1);
    assert.equal(listing.items[0]?.id, translation.id);
    assert.equal(listing.items[0]?.langTo, "en");

    await assert.rejects(
      updateProjectTranslationWorkflow({
        projectId: project.id,
        translationId: translation.id,
        actor: manager,
        patch: { assignedToId: foreignReviewer.id },
      }),
      (error) =>
        error instanceof TranslationWorkflowError &&
        error.code === "INVALID_ASSIGNEE",
    );

    const deleteCandidate = await db.translation.create({
      data: {
        projectId: project.id,
        originalHash: `delete-${suffix}`,
        originalText: "Diesen Satz entfernen.",
        translatedText: "Remove this sentence.",
        langFrom: "de",
        langTo: "en",
        source: "OPENAI",
        wordCount: 3,
      },
    });
    await assert.rejects(
      deleteProjectTranslation({
        projectId: project.id,
        translationId: deleteCandidate.id,
        actor: {
          canManage: false,
          projectMemberId: reviewer.id,
          langCode: "en",
        },
        expectedUpdatedAt: deleteCandidate.updatedAt,
      }),
      (error) =>
        error instanceof TranslationWorkflowError && error.code === "FORBIDDEN",
    );
    await deleteProjectTranslation({
      projectId: project.id,
      translationId: deleteCandidate.id,
      actor: manager,
      expectedUpdatedAt: deleteCandidate.updatedAt,
    });
    assert.equal(
      await db.translation.count({ where: { id: deleteCandidate.id } }),
      0,
    );
    assert.equal(
      await db.webhookDelivery.count({
        where: { projectId: project.id, eventType: "translation.deleted" },
      }),
      1,
    );

    await assert.rejects(
      updateProjectTranslationWorkflow({
        projectId: foreignProject.id,
        translationId: translation.id,
        actor: manager,
        patch: { status: "ASSIGNED" },
      }),
      (error) =>
        error instanceof TranslationWorkflowError && error.code === "NOT_FOUND",
    );

    const frenchTranslation = await db.translation.create({
      data: {
        projectId: project.id,
        originalHash: `hash-fr-${suffix}`,
        originalText: "Ein französischer Prüfsatz.",
        translatedText: "Une phrase française à réviser.",
        langFrom: "de",
        langTo: "fr",
        source: "OPENAI",
        wordCount: 4,
      },
    });
    await updateProjectTranslationWorkflow({
      projectId: project.id,
      translationId: frenchTranslation.id,
      actor: manager,
      patch: { assignedToId: reviewer.id },
    });
    await updateProjectTranslationWorkflow({
      projectId: project.id,
      translationId: frenchTranslation.id,
      actor: manager,
      patch: { status: "IN_REVIEW" },
    });
    await updateProjectTranslationWorkflow({
      projectId: project.id,
      translationId: translation.id,
      actor: manager,
      patch: { status: "ASSIGNED" },
    });
    await updateProjectTranslationWorkflow({
      projectId: project.id,
      translationId: translation.id,
      actor: manager,
      patch: { status: "IN_REVIEW" },
    });

    await db.$transaction(async (tx) => {
      await resetProjectMemberWorkflowAssignments(tx, {
        projectId: project.id,
        memberId: reviewer.id,
        exceptLangCode: "en",
      });
      await tx.projectMember.update({
        where: { id: reviewer.id },
        data: { langCode: "en" },
      });
    });

    assert.deepEqual(
      await db.translation.findUniqueOrThrow({
        where: { id: frenchTranslation.id },
        select: { workflowStatus: true, assignedToId: true },
      }),
      { workflowStatus: "MACHINE", assignedToId: null },
    );
    assert.deepEqual(
      await db.translation.findUniqueOrThrow({
        where: { id: translation.id },
        select: { workflowStatus: true, assignedToId: true },
      }),
      { workflowStatus: "IN_REVIEW", assignedToId: reviewer.id },
    );

    await db.$transaction(async (tx) => {
      await resetProjectMemberWorkflowAssignments(tx, {
        projectId: project.id,
        memberId: reviewer.id,
      });
      await tx.projectMember.delete({ where: { id: reviewer.id } });
    });

    assert.deepEqual(
      await db.translation.findUniqueOrThrow({
        where: { id: translation.id },
        select: { workflowStatus: true, assignedToId: true },
      }),
      { workflowStatus: "MACHINE", assignedToId: null },
    );
    assert.equal(
      await db.translation.count({
        where: {
          projectId: project.id,
          assignedToId: null,
          workflowStatus: { in: ["ASSIGNED", "IN_REVIEW"] },
        },
      }),
      0,
    );
  },
);

after(async () => {
  if (databaseUrl && cleanupOrganizationIds.size > 0) {
    const { db } = await import("@/lib/db");
    await db.organization.deleteMany({
      where: { id: { in: [...cleanupOrganizationIds] } },
    });
    await db.$disconnect();
  }
});
