import { Prisma, type Project } from "@prisma/client";

import { db } from "@/lib/db";
import { chunk } from "@/lib/import-export";
import { canAccessProjectForWrite, canAccessProjectLanguage, canManageProject, type ProjectAccessContext } from "@/lib/project-access";
import { isProjectRuntimeSerializationConflict, lockAndValidateProjectLanguageWrite } from "@/lib/project-runtime-configuration-lock";
import { queueProjectWebhookEvent } from "@/lib/project-webhook-delivery";
import { assertPostgresTextFields } from "@/lib/postgres-text";
import { recordTranslationBatch } from "@/lib/translation-batches";
import { recordTranslationCacheInvalidations } from "@/lib/translation-cache-invalidation";
import { computeTranslationHash } from "@/lib/translation-hash";
import { parseXliff, planXliffImport, XliffError, type XliffSegment } from "@/lib/xliff";

export class ProjectXliffImportError extends Error {
  constructor(message: string, public readonly status = 400, public readonly issues: Array<{ segment: number; message: string }> = []) {
    super(message);
    this.name = "ProjectXliffImportError";
  }
}

export async function importTranslationsXliff(input: {
  bytes: Uint8Array;
  project: Project;
  access: ProjectAccessContext;
  userId: string;
  langTo: string;
  applyApproved: boolean;
  emitRowEvents: boolean;
}) {
  const { project, access, langTo, applyApproved, emitRowEvents } = input;
  if (langTo.length > 35 || !/^[a-z]{2,3}(?:-[a-z0-9]{2,8})*$/i.test(langTo)) {
    throw new ProjectXliffImportError("Invalid target language", 400);
  }
  if (!langTo || !canAccessProjectLanguage(access, langTo)) {
    throw new ProjectXliffImportError("Target language is missing or forbidden", 403);
  }
  if (applyApproved && !canManageProject(access)) {
    throw new ProjectXliffImportError("Only project managers may confirm imported approvals", 403);
  }
  let rows: XliffSegment[];
  try {
    rows = parseXliff(input.bytes, { projectId: project.id, langFrom: project.originalLang, langTo }, { allowPersistedIds: true });
  } catch (error) {
    if (error instanceof XliffError) {
      throw new ProjectXliffImportError(error.message, 400, error.line ? [{ segment: error.line, message: error.detail }] : []);
    }
    throw error;
  }
  for (const row of rows) {
    assertPostgresTextFields({ originalText: row.source, translatedText: row.target }, { boundary: "translation_import_persistence", index: row.line });
  }

  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      await db.$transaction(async (tx) => {
        const currentAccess = await canAccessProjectForWrite(tx, input.userId, project.id);
        if (!currentAccess || !canAccessProjectLanguage(currentAccess, langTo) || (applyApproved && !canManageProject(currentAccess))) {
          throw new ProjectXliffImportError("Project access changed; no segments imported", 403);
        }
        if (!(await lockAndValidateProjectLanguageWrite(tx, {
          projectId: project.id,
          sourceLanguages: [project.originalLang],
          targetLanguages: [langTo],
        }))) {
          throw new ProjectXliffImportError("Project language configuration changed; no segments imported", 409);
        }
        const lockedProject = await tx.project.findUniqueOrThrow({ where: { id: project.id }, select: { organizationId: true } });
        const existing = await tx.translation.findMany({
          where: { projectId: project.id, originalHash: { in: rows.map((row) => row.id) } },
          select: { id: true, originalHash: true, originalText: true, translatedText: true, langFrom: true, langTo: true,
            isManual: true, source: true, workflowStatus: true, assignedToId: true },
        });
        const issues = planXliffImport(rows, existing, applyApproved);
        const existingIds = new Set(existing.map((item) => item.originalHash));
        for (const row of rows) {
          if (!existingIds.has(row.id) && row.id !== computeTranslationHash(row.source, project.originalLang, langTo)) {
            issues.push({ segment: row.line, message: "Legacy segment ID has no matching translation" });
          }
        }
        for (const item of existing) {
          const row = rows.find((candidate) => candidate.id === item.originalHash);
          if (row && (item.originalText !== row.source ||
              item.langFrom.toLowerCase() !== project.originalLang.toLowerCase() ||
              item.langTo.toLowerCase() !== langTo.toLowerCase() ||
              item.originalHash !== computeTranslationHash(row.source, item.langFrom, item.langTo))) {
            issues.push({ segment: row.line, message: "Stored source or language conflicts with segment ID" });
          }
        }
        if (issues.length) throw new ProjectXliffImportError("XLIFF validation failed; no segments imported", 409, issues);
        const current = new Map(existing.map((item) => [item.originalHash, item]));
        const creates: Array<{ projectId: string; originalHash: string; originalText: string; translatedText: string;
          langFrom: string; langTo: string; isManual: true; source: "IMPORT"; wordCount: number;
          workflowStatus: "APPROVED" | "MACHINE" }> = [];
        const updates: Array<{ id: string; originalHash: string; originalText: string; translatedText: string; langFrom: string; langTo: string;
          isManual: boolean; source: string; workflowStatus: string }> = [];
        for (const row of rows) {
          const previous = current.get(row.id);
          // An external file may only preserve an unchanged existing machine row.
          // New or edited text is a human import even if the file claims otherwise.
          const preserveMachine = row.manual === false && previous && !previous.isManual && previous.translatedText === row.target;
          const nextManual = !preserveMachine;
          const nextSource = previous?.isManual || preserveMachine ? previous?.source : "IMPORT";
          const nextWorkflow = row.approved ? "APPROVED" : previous?.translatedText === row.target
            ? previous?.workflowStatus ?? "MACHINE" : previous?.assignedToId ? "ASSIGNED" : "MACHINE";
          if (!previous) {
            creates.push({ projectId: project.id, originalHash: row.id, originalText: row.source,
              translatedText: row.target, langFrom: project.originalLang, langTo, isManual: true,
              source: "IMPORT", wordCount: row.source.trim().split(/\s+/).filter(Boolean).length,
              workflowStatus: row.approved ? "APPROVED" : "MACHINE" });
          } else if (previous.translatedText !== row.target || previous.isManual !== nextManual ||
              previous.source !== nextSource || previous.workflowStatus !== nextWorkflow) {
            updates.push({ id: previous.id, originalHash: row.id, originalText: row.source,
              langFrom: previous.langFrom, langTo: previous.langTo,
              translatedText: row.target, isManual: nextManual, source: nextSource ?? "IMPORT",
              workflowStatus: nextWorkflow });
          }
        }
        const created = [] as Array<{ id: string; originalHash: string; originalText: string; translatedText: string;
          langFrom: string; langTo: string }>;
        for (const slice of chunk(creates, 100)) {
          created.push(...await tx.translation.createManyAndReturn({ data: slice,
            select: { id: true, originalHash: true, originalText: true, translatedText: true, langFrom: true, langTo: true } }));
        }
        for (const slice of chunk(updates, 100)) {
          const values = Prisma.join(slice.map((item) => Prisma.sql`(${item.id}, ${item.translatedText}, ${item.isManual},
            ${item.source}::"TranslationSource", ${item.workflowStatus}::"TranslationWorkflowStatus")`));
          const changed = await tx.$executeRaw(Prisma.sql`
            UPDATE "Translation" AS translation SET
              "translatedText" = incoming.text, "isManual" = incoming.manual::boolean,
              "source" = incoming.source, "workflowStatus" = incoming.workflow,
              "updatedAt" = NOW()
            FROM (VALUES ${values}) AS incoming(id, text, manual, source, workflow)
            WHERE translation.id = incoming.id
          `);
          if (changed !== slice.length) throw new ProjectXliffImportError("Concurrent update; no segments imported", 409);
        }
        const invalidations = [
          ...created.map((item) => ({ id: item.id, originalText: item.originalText, langFrom: item.langFrom, langTo: item.langTo })),
          ...updates.map((item) => ({ id: item.id, originalText: item.originalText, langFrom: item.langFrom, langTo: item.langTo })),
        ];
        await recordTranslationCacheInvalidations(tx, project.id, invalidations);
        if (emitRowEvents && invalidations.length) {
          const events = [
            ...created.map((item) => ({ type: "translation.created" as const, item })),
            ...updates.map((item) => ({ type: "translation.updated" as const, item })),
          ];
          for (const slice of chunk(events, 250)) {
            const payloads = slice.map(({ type, item }) => ({ type, payload: { type, translationId: item.id,
              originalText: item.originalText, translatedText: item.translatedText,
              langFrom: item.langFrom, langTo: item.langTo, imported: true } }));
            await tx.$executeRaw`
              INSERT INTO "WebhookDelivery" ("id", "eventType", "payload", "endpointId", "projectId",
                "status", "attemptCount", "nextAttemptAt", "createdAt", "updatedAt")
              SELECT gen_random_uuid()::text, event.type, event.payload, endpoint.id, ${project.id},
                'PENDING'::"WebhookDeliveryStatus", 0, NOW(), NOW(), NOW()
              FROM jsonb_to_recordset(${JSON.stringify(payloads)}::jsonb) AS event(type text, payload jsonb)
              JOIN "WebhookEndpoint" AS endpoint ON endpoint."projectId" = ${project.id}
                AND endpoint."enabled" = true AND event.type = ANY(endpoint."eventTypes")
            `;
          }
        }
        const contentChanges = [...created, ...updates.filter((item) =>
          current.get(item.originalHash)?.translatedText !== item.translatedText)];
        const words = contentChanges.reduce((sum, item) =>
          sum + item.originalText.trim().split(/\s+/).filter(Boolean).length, 0);
        if (contentChanges.length) await recordTranslationBatch({ organizationId: lockedProject.organizationId, projectId: project.id,
          langFrom: project.originalLang, langTo, provider: "import", totalWords: words,
          cachedWords: 0, manualWords: words, glossaryWords: 0, translatedWords: 0 }, tx);
        await queueProjectWebhookEvent({ projectId: project.id, eventType: "import.completed",
          payload: { type: "import.completed", asset: "translations", format: "xliff", importedRows: rows.length } }, tx);
      }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable, maxWait: 10_000, timeout: 120_000 });
      return { importedRows: rows.length };
    } catch (error) {
      if (isProjectRuntimeSerializationConflict(error) && attempt < 2) continue;
      if (isProjectRuntimeSerializationConflict(error)) throw new ProjectXliffImportError("Concurrent update; no segments imported", 409);
      throw error;
    }
  }
  throw new ProjectXliffImportError("Concurrent update; no segments imported", 409);
}
