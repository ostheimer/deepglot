import { Prisma, type Project } from "@prisma/client";

import { db } from "@/lib/db";
import { canAccessProjectLanguage, canManageProject, type ProjectAccessContext } from "@/lib/project-access";
import { isProjectRuntimeSerializationConflict, lockAndValidateProjectLanguageWrite } from "@/lib/project-runtime-configuration-lock";
import { queueProjectWebhookEvent } from "@/lib/project-webhook-delivery";
import { assertPostgresTextFields } from "@/lib/postgres-text";
import { recordTranslationBatch } from "@/lib/translation-batches";
import { workflowResetFieldsIfTranslatedTextChanged } from "@/lib/translation-workflow";
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
  langTo: string;
  applyApproved: boolean;
  emitRowEvents: boolean;
}) {
  const { project, access, langTo, applyApproved, emitRowEvents } = input;
  if (!langTo || !canAccessProjectLanguage(access, langTo)) {
    throw new ProjectXliffImportError("Target language is missing or forbidden", 403);
  }
  if (applyApproved && !canManageProject(access)) {
    throw new ProjectXliffImportError("Only project managers may confirm imported approvals", 403);
  }
  let rows: XliffSegment[];
  try {
    rows = parseXliff(input.bytes, { projectId: project.id, langFrom: project.originalLang, langTo });
  } catch (error) {
    if (error instanceof XliffError) {
      throw new ProjectXliffImportError(error.message, 400, error.line ? [{ segment: error.line, message: error.message }] : []);
    }
    throw error;
  }
  for (const row of rows) {
    assertPostgresTextFields({ originalText: row.source, translatedText: row.target }, { boundary: "translation_import_persistence", index: row.line });
  }

  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      await db.$transaction(async (tx) => {
        if (!(await lockAndValidateProjectLanguageWrite(tx, {
          projectId: project.id,
          sourceLanguages: [project.originalLang],
          targetLanguages: [langTo],
        }))) {
          throw new ProjectXliffImportError("Project language configuration changed; no segments imported", 409);
        }
        const existing = await tx.translation.findMany({
          where: { projectId: project.id, originalHash: { in: rows.map((row) => row.id) } },
          select: { id: true, originalHash: true, originalText: true, translatedText: true, isManual: true, workflowStatus: true, assignedToId: true },
        });
        const issues = planXliffImport(rows, existing, applyApproved);
        for (const item of existing) {
          const row = rows.find((candidate) => candidate.id === item.originalHash);
          if (row && item.originalText !== row.source) issues.push({ segment: row.line, message: "Stored source conflicts with segment ID" });
        }
        if (issues.length) throw new ProjectXliffImportError("XLIFF validation failed; no segments imported", 409, issues);
        const current = new Map(existing.map((item) => [item.originalHash, item]));
        for (const row of rows) {
          const previous = current.get(row.id);
          const saved = await tx.translation.upsert({
            where: { projectId_originalHash: { projectId: project.id, originalHash: row.id } },
            create: {
              projectId: project.id, originalHash: row.id, originalText: row.source,
              translatedText: row.target, langFrom: project.originalLang, langTo,
              isManual: true, source: "IMPORT", wordCount: row.source.trim().split(/\s+/).filter(Boolean).length,
              workflowStatus: row.approved ? "APPROVED" : "MACHINE",
            },
            update: {
              translatedText: row.target,
              isManual: true,
              ...(previous?.isManual ? {} : { source: "IMPORT" as const }),
              ...(previous ? workflowResetFieldsIfTranslatedTextChanged(previous, row.target) : {}),
              ...(row.approved ? { workflowStatus: "APPROVED" } : {}),
            },
          });
          if (emitRowEvents) await queueProjectWebhookEvent({
            projectId: project.id,
            eventType: previous ? "translation.updated" : "translation.created",
            payload: { type: previous ? "translation.updated" : "translation.created", translationId: saved.id,
              originalText: saved.originalText, translatedText: saved.translatedText,
              langFrom: saved.langFrom, langTo: saved.langTo, imported: true },
          }, tx);
        }
        const words = rows.reduce((sum, row) => sum + row.source.trim().split(/\s+/).filter(Boolean).length, 0);
        if (rows.length) await recordTranslationBatch({ organizationId: project.organizationId, projectId: project.id,
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
