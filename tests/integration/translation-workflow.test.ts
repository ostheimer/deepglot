import assert from "node:assert/strict";
import { after, test } from "node:test";

import { resolveDatabaseUrl } from "@/lib/database-url";
import {
  TranslationWorkflowError,
  listProjectTranslationWorkflow,
  resetProjectMemberWorkflowAssignments,
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
  async () => {
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
        languages: { create: [{ langCode: "en" }, { langCode: "fr" }] },
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
