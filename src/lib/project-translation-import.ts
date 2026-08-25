import type { Prisma, Project } from "@prisma/client";

import { db } from "@/lib/db";
import {
  MAX_IMPORT_ROWS,
  chunk,
  parseTranslationsCsv,
} from "@/lib/import-export";
import {
  canAccessProjectLanguage,
  type ProjectAccessContext,
} from "@/lib/project-access";
import { lockAndValidateProjectLanguageWrite } from "@/lib/project-runtime-configuration-lock";
import { queueProjectWebhookEvent } from "@/lib/project-webhook-delivery";
import {
  assertPostgresTextFields,
  PostgresTextBoundaryError,
  reportPostgresTextRejection,
} from "@/lib/postgres-text";
import type { SiteLocale } from "@/lib/site-locale";
import { uiText } from "@/lib/static-copy";
import { recordTranslationBatch } from "@/lib/translation-batches";
import { computeTranslationHash } from "@/lib/translation-hash";
import { workflowResetFieldsIfTranslatedTextChanged } from "@/lib/translation-workflow";

const IMPORT_CHUNK_SIZE = 100;
const IMPORT_TX_OPTIONS = { maxWait: 10_000, timeout: 60_000 } as const;

function t(locale: SiteLocale, deText: string, enText: string) {
  return uiText(locale, enText, deText);
}

function countWords(text: string) {
  return text.trim().split(/\s+/).filter(Boolean).length;
}

export class ProjectTranslationImportError extends Error {
  status: number;

  constructor(message: string, status = 400) {
    super(message);
    this.name = "ProjectTranslationImportError";
    this.status = status;
  }
}

function parseImport<T>(parse: () => T, locale: SiteLocale): T {
  try {
    return parse();
  } catch (error) {
    if (error instanceof PostgresTextBoundaryError) {
      reportPostgresTextRejection(error);
      const position = error.event.index
        ? t(
            locale,
            ` in Zeile/Eintrag ${error.event.index}`,
            ` at line/entry ${error.event.index}`,
          )
        : "";
      throw new ProjectTranslationImportError(
        t(
          locale,
          `Das Importfeld „${error.event.field}“${position} enthält ein nicht unterstütztes NUL-Zeichen (U+0000).`,
          `Import field "${error.event.field}"${position} contains an unsupported NUL character (U+0000).`,
        ),
      );
    }

    throw new ProjectTranslationImportError(
      error instanceof Error ? error.message : "Invalid file",
    );
  }
}

function assertRowLimit(count: number, locale: SiteLocale) {
  if (count > MAX_IMPORT_ROWS) {
    throw new ProjectTranslationImportError(
      t(
        locale,
        `Zu viele Zeilen (${count}). Maximal ${MAX_IMPORT_ROWS} pro Import – bitte die Datei aufteilen.`,
        `Too many rows (${count}). The maximum is ${MAX_IMPORT_ROWS} per import — please split the file.`,
      ),
      413,
    );
  }
}

function assertLanguagesAllowed(
  access: ProjectAccessContext,
  langTos: Iterable<string>,
  locale: SiteLocale,
) {
  for (const langTo of new Set(langTos)) {
    if (!canAccessProjectLanguage(access, langTo)) {
      throw new ProjectTranslationImportError(
        t(
          locale,
          `Keine Berechtigung für die Sprache "${langTo}".`,
          `You are not authorized for the language "${langTo}".`,
        ),
        403,
      );
    }
  }
}

async function writeInChunks<T>(
  items: readonly T[],
  locale: SiteLocale,
  beforeChunk: (
    items: readonly T[],
    tx: Prisma.TransactionClient,
  ) => Promise<void>,
  handler: (item: T, tx: Prisma.TransactionClient) => Promise<void>,
) {
  let committed = 0;
  for (const slice of chunk(items, IMPORT_CHUNK_SIZE)) {
    try {
      await db.$transaction(async (tx) => {
        await beforeChunk(slice, tx);
        for (const item of slice) {
          await handler(item, tx);
        }
      }, IMPORT_TX_OPTIONS);
    } catch (error) {
      if (error instanceof ProjectTranslationImportError) {
        throw error;
      }
      console.error(
        `[import] chunk failed after ${committed} committed rows:`,
        error,
      );
      throw new ProjectTranslationImportError(
        t(
          locale,
          `Import nach ${committed} Zeilen abgebrochen. Bereits importierte Zeilen bleiben gespeichert – ein erneuter Import ist sicher und aktualisiert vorhandene Zeilen.`,
          `Import stopped after ${committed} rows. Rows imported so far are kept — re-running the import is safe and updates existing rows.`,
        ),
      );
    }
    committed += slice.length;
  }
}

function languageConfigurationChanged(locale: SiteLocale) {
  return new ProjectTranslationImportError(
    t(
      locale,
      "Die Sprachkonfiguration des Projekts hat sich geändert. Bitte neu laden und den Import erneut starten.",
      "The project's language configuration changed. Reload and restart the import.",
    ),
    409,
  );
}

export type ProjectTranslationImportContext = {
  project: Project;
  access: ProjectAccessContext;
  locale: SiteLocale;
  emitRowEvents: boolean;
};

/**
 * Parses the complete CSV before opening a transaction, then persists the
 * bounded translation chunks used by the project import route.
 */
export async function importTranslationsCsv(
  content: string,
  { project, access, locale, emitRowEvents }: ProjectTranslationImportContext,
) {
  const rows = parseImport(() => parseTranslationsCsv(content), locale);
  assertRowLimit(rows.length, locale);
  assertLanguagesAllowed(
    access,
    rows.map((row) => row.langTo),
    locale,
  );

  for (const row of rows) {
    if (!row.originalText || !row.translatedText) {
      throw new ProjectTranslationImportError(
        t(
          locale,
          `Zeile ${row.line}: Übersetzungsdaten unvollständig`,
          `Line ${row.line}: translation data is incomplete`,
        ),
      );
    }
  }

  await writeInChunks(
    rows,
    locale,
    async (slice, tx) => {
      const languageConfigurationIsCurrent =
        await lockAndValidateProjectLanguageWrite(tx, {
          projectId: project.id,
          sourceLanguages: slice.map((row) => row.langFrom),
          targetLanguages: slice.map((row) => row.langTo),
        });
      if (!languageConfigurationIsCurrent) {
        throw languageConfigurationChanged(locale);
      }
    },
    async (row, tx) => {
      const originalHash = computeTranslationHash(
        row.originalText,
        row.langFrom,
        row.langTo,
      );
      const existing = await tx.translation.findUnique({
        where: {
          projectId_originalHash: { projectId: project.id, originalHash },
        },
        select: {
          id: true,
          workflowStatus: true,
          assignedToId: true,
          translatedText: true,
        },
      });
      assertPostgresTextFields(
        {
          originalText: row.originalText,
          translatedText: row.translatedText,
          langFrom: row.langFrom,
          langTo: row.langTo,
        },
        { boundary: "translation_import_persistence", index: row.line },
      );
      const translation = await tx.translation.upsert({
        where: {
          projectId_originalHash: { projectId: project.id, originalHash },
        },
        create: {
          projectId: project.id,
          originalHash,
          originalText: row.originalText,
          translatedText: row.translatedText,
          langFrom: row.langFrom,
          langTo: row.langTo,
          isManual: true,
          source: "IMPORT",
          wordCount: countWords(row.originalText),
        },
        update: {
          translatedText: row.translatedText,
          langFrom: row.langFrom,
          langTo: row.langTo,
          isManual: true,
          source: "IMPORT",
          ...(existing
            ? workflowResetFieldsIfTranslatedTextChanged(
                existing,
                row.translatedText,
              )
            : {}),
        },
      });

      if (emitRowEvents) {
        await queueProjectWebhookEvent(
          {
            projectId: project.id,
            eventType: existing ? "translation.updated" : "translation.created",
            payload: {
              type: existing ? "translation.updated" : "translation.created",
              translationId: translation.id,
              originalText: translation.originalText,
              translatedText: translation.translatedText,
              langFrom: translation.langFrom,
              langTo: translation.langTo,
              imported: true,
            },
          },
          tx,
        );
      }
    },
  );

  const wordsByPair = new Map<
    string,
    { langFrom: string; langTo: string; words: number }
  >();
  for (const row of rows) {
    const key = JSON.stringify([row.langFrom, row.langTo]);
    const entry =
      wordsByPair.get(key) ??
      { langFrom: row.langFrom, langTo: row.langTo, words: 0 };
    entry.words += countWords(row.originalText);
    wordsByPair.set(key, entry);
  }

  for (const { langFrom, langTo, words } of wordsByPair.values()) {
    await recordTranslationBatch({
      organizationId: project.organizationId,
      projectId: project.id,
      langFrom,
      langTo,
      provider: "import",
      totalWords: words,
      cachedWords: 0,
      manualWords: words,
      glossaryWords: 0,
      translatedWords: 0,
    });
  }

  await queueProjectWebhookEvent({
    projectId: project.id,
    eventType: "import.completed",
    payload: {
      type: "import.completed",
      asset: "translations",
      format: "csv",
      importedRows: rows.length,
    },
  });

  return { importedRows: rows.length };
}
