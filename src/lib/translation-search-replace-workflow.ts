import { Prisma } from "@prisma/client";
import { db } from "./db";
import { appendProjectAuditEvent } from "./audit-events";
import { canAccessProject, canManageProject } from "./project-access-policy";
import { lockAndValidateProjectLanguageWrite } from "./project-runtime-configuration-lock";
import { queueProjectWebhookEvent } from "./project-webhook-delivery";
import { recordTranslationBatch } from "./translation-batches";
import { recordTranslationCacheInvalidations } from "./translation-cache-invalidation";
import { REPORTED_TYPE_GROUPS } from "./translation-reported-types";
import { MAX_WORKSPACE_REPLACE_ITEMS, planWorkspaceReplacement, replacementFingerprint } from "./translation-search-replace";
import { assertTranslationContentMutationAllowed, assertValidTranslationContent, resetTranslationWorkflowAfterContentEdit, TranslationWorkflowError, type TranslationWorkflowActor } from "./translation-workflow";

export type ReplacementSelection = { id: string; expectedUpdatedAt: Date };

function validateSelection(items: ReplacementSelection[]) {
  if (items.length < 1 || items.length > MAX_WORKSPACE_REPLACE_ITEMS ||
      new Set(items.map((item) => item.id)).size !== items.length ||
      items.some((item) => !Number.isFinite(item.expectedUpdatedAt.getTime())))
    throw new TranslationWorkflowError("INVALID_PAYLOAD", "Select 1 to 100 distinct segments.");
}

function planRows(rows: Awaited<ReturnType<typeof db.translation.findMany<{
  include: { typeObservations: true; project: { select: { organizationId: true } } }
}>>>, rules: { langFrom: string; langTo: string; translatedTerm: string }[], input: {
  projectId: string; userId: string; actor: TranslationWorkflowActor;
  items: ReplacementSelection[]; find: string; replace: string; includeReviewed?: boolean;
}) {
  const byId = new Map(rows.map((row) => [row.id, row]));
  const planned = input.items.map(({ id, expectedUpdatedAt }) => {
    const row = byId.get(id);
    if (!row) throw new TranslationWorkflowError("NOT_FOUND", "A selected segment is unavailable. Reload and retry.");
    if (row.updatedAt.getTime() !== expectedUpdatedAt.getTime())
      throw new TranslationWorkflowError("STALE_UPDATE", "A selected segment changed. Reload and retry.");
    assertTranslationContentMutationAllowed({ actor: input.actor, langTo: row.langTo,
      assignedToId: row.assignedToId, operation: "edit" });
    if ((!input.includeReviewed && (row.isManual || row.workflowStatus === "APPROVED")) ||
        !row.typeObservations.length ||
        row.typeObservations.some((type) => !REPORTED_TYPE_GROUPS.text.includes(type.wordType as never)))
      throw new TranslationWorkflowError("INVALID_TRANSITION", "Search and replace requires reported text; reviewed text must be included explicitly.");
    let after: string | null;
    try {
      after = planWorkspaceReplacement({
        originalText: row.originalText, translatedText: row.translatedText,
        find: input.find, replace: input.replace,
        glossaryTerms: rules.filter((rule) => rule.langFrom === row.langFrom && rule.langTo === row.langTo)
          .map((rule) => rule.translatedTerm).filter(Boolean),
      });
    } catch {
      throw new TranslationWorkflowError("INVALID_PAYLOAD", "Replacement changes protected content. Refine the selection or search text.");
    }
    if (!after) throw new TranslationWorkflowError("INVALID_PAYLOAD", "Search text is absent from a selected segment.");
    assertValidTranslationContent(after);
    return { row, after };
  });
  const fingerprint = replacementFingerprint({
    projectId: input.projectId, userId: input.userId,
    find: input.find, replace: input.replace, includeReviewed: input.includeReviewed === true,
    rows: planned.map(({ row, after }) => ({
      id: row.id, updatedAt: row.updatedAt.toISOString(), before: row.translatedText, after,
    })),
  });
  return { planned, fingerprint };
}

export async function previewWorkspaceReplacement(input: {
  projectId: string; userId: string; actor: TranslationWorkflowActor;
  items: ReplacementSelection[]; find: string; replace: string; includeReviewed?: boolean;
}) {
  validateSelection(input.items);
  const rows = await db.translation.findMany({
    where: { projectId: input.projectId, id: { in: input.items.map((item) => item.id) } },
    include: { typeObservations: true, project: { select: { organizationId: true } } },
  });
  const rules = await db.glossaryRule.findMany({
    where: { projectId: input.projectId }, select: { langFrom: true, langTo: true, translatedTerm: true },
  });
  const result = planRows(rows, rules, input);
  return {
    fingerprint: result.fingerprint,
    items: result.planned.map(({ row, after }) => ({ id: row.id, before: row.translatedText, after,
      reviewed: row.isManual || row.workflowStatus === "APPROVED", statusAfter: row.assignedToId ? "assigned" : "machine" })),
  };
}

/** Exact selected rows commit together after fresh locks, actor checks and preview CAS. */
export async function applyWorkspaceReplacement(input: {
  projectId: string; userId: string; actor: TranslationWorkflowActor;
  items: ReplacementSelection[]; find: string; replace: string; includeReviewed?: boolean; fingerprint: string;
}) {
  validateSelection(input.items);
  return db.$transaction(async (tx) => {
    if (!(await lockAndValidateProjectLanguageWrite(tx, { projectId: input.projectId })))
      throw new TranslationWorkflowError("NOT_FOUND", "Project not found.");
    const ids = input.items.map((item) => item.id).sort();
    const locked = await tx.$queryRaw<Array<{ id: string }>>(Prisma.sql`
      SELECT "id" FROM "Translation" WHERE "projectId" = ${input.projectId}
      AND "id" IN (${Prisma.join(ids)}) ORDER BY "id" FOR UPDATE
    `);
    if (locked.length !== ids.length)
      throw new TranslationWorkflowError("NOT_FOUND", "A selected segment is unavailable. Reload and retry.");
    const project = await tx.project.findUniqueOrThrow({
      where: { id: input.projectId }, select: { organizationId: true },
    });
    await tx.$queryRaw`SELECT "id" FROM "ProjectMember" WHERE "projectId" = ${input.projectId} AND "userId" = ${input.userId} FOR SHARE`;
    await tx.$queryRaw`SELECT "id" FROM "OrganizationMember" WHERE "organizationId" = ${project.organizationId} AND "userId" = ${input.userId} FOR SHARE`;
    const member = await tx.projectMember.findFirst({ where: { projectId: input.projectId, userId: input.userId }, select: { id: true, role: true, langCode: true } });
    const organizationMember = await tx.organizationMember.findFirst({ where: { organizationId: project.organizationId, userId: input.userId }, select: { role: true } });
    const rows = await tx.translation.findMany({ where: { projectId: input.projectId, id: { in: ids } },
      include: { typeObservations: true, project: { select: { organizationId: true } } } });
    const rules = await tx.glossaryRule.findMany({ where: { projectId: input.projectId }, select: { langFrom: true, langTo: true, translatedTerm: true } });
    const access = { projectRole: member?.role ?? null, organizationRole: organizationMember?.role ?? null,
      langCode: member?.langCode ?? null };
    if (!canAccessProject(access))
      throw new TranslationWorkflowError("FORBIDDEN", "Project access changed. Reload and retry.");
    const actor = { canManage: canManageProject(access), projectMemberId: member?.id ?? null,
      langCode: access.langCode };
    if (!(await lockAndValidateProjectLanguageWrite(tx, { projectId: input.projectId,
      sourceLanguages: rows.map((row) => row.langFrom), targetLanguages: rows.map((row) => row.langTo) })))
      throw new TranslationWorkflowError("INVALID_LANGUAGE", "A selected segment uses an inactive language pair.");
    const { planned, fingerprint } = planRows(rows, rules, { ...input, actor });
    if (fingerprint !== input.fingerprint)
      throw new TranslationWorkflowError("STALE_UPDATE", "The preview changed. Preview again before applying.");
    for (const { row, after } of planned) {
      const changed = await tx.translation.updateMany({
        where: { id: row.id, projectId: input.projectId, updatedAt: row.updatedAt },
        data: { translatedText: after, isManual: true, source: "MANUAL",
          ...resetTranslationWorkflowAfterContentEdit(row) },
      });
      if (changed.count !== 1)
        throw new TranslationWorkflowError("STALE_UPDATE", "A selected segment changed. Reload and retry.");
      await tx.translationContentRevision.create({ data: {
        translationId: row.id, actorUserId: input.userId,
        beforeText: row.translatedText, afterText: after,
      } });
      await recordTranslationBatch({
        organizationId: project.organizationId, projectId: input.projectId,
        langFrom: row.langFrom, langTo: row.langTo, provider: "manual",
        totalWords: row.wordCount, cachedWords: 0, manualWords: row.wordCount,
        glossaryWords: 0, translatedWords: 0,
      }, tx);
      await queueProjectWebhookEvent({ projectId: input.projectId,
        eventType: "translation.manual_updated", payload: {
          type: "translation.manual_updated", translationId: row.id,
          originalText: row.originalText, translatedText: after,
          langFrom: row.langFrom, langTo: row.langTo, created: false,
        } }, tx);
    }
    await recordTranslationCacheInvalidations(tx, input.projectId, planned.map(({ row }) => row));
    if (planned.length > 0) await appendProjectAuditEvent(tx, { projectId: input.projectId,
      actorUserId: input.userId, action: "translation.search_replaced", category: "translation",
      metadata: { count: planned.length } });
    return { updated: planned.length };
  }, { timeout: 15_000 });
}
