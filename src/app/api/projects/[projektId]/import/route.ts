import { NextRequest, NextResponse } from "next/server";
import type { Prisma, Project } from "@prisma/client";

import { db } from "@/lib/db";
import {
  MAX_IMPORT_ROWS,
  chunk,
  parseGlossaryCsv,
  parsePoTranslations,
  parseSlugsCsv,
  parseTranslationsCsv,
} from "@/lib/import-export";
import {
  canAccessProject,
  canAccessProjectLanguage,
  getAuthenticatedUserId,
  getProjectAccess,
  type ProjectAccessContext,
} from "@/lib/project-access";
import { queueProjectWebhookEvent } from "@/lib/project-webhook-delivery";
import { getCookieLocale } from "@/lib/request-locale";
import { recordTranslationBatch } from "@/lib/translation-batches";
import { computeTranslationHash } from "@/lib/translation-hash";
import type { SiteLocale } from "@/lib/site-locale";
import { uiText } from "@/lib/static-copy";

export const runtime = "nodejs";

// Process imports in bounded chunks, each in its own short transaction. This
// keeps every transaction well under the database timeout instead of wrapping
// thousands of row writes in one long-running transaction (which would hit
// Prisma's 5s interactive-transaction default and fail).
const IMPORT_CHUNK_SIZE = 100;
const IMPORT_TX_OPTIONS = { maxWait: 10_000, timeout: 60_000 } as const;

function t(locale: SiteLocale, deText: string, enText: string) {
  return uiText(locale, enText, deText);
}

function countWords(text: string) {
  return text.trim().split(/\s+/).filter(Boolean).length;
}

/** A user-facing import failure that carries an HTTP status code. */
class ImportError extends Error {
  status: number;

  constructor(message: string, status = 400) {
    super(message);
    this.name = "ImportError";
    this.status = status;
  }
}

/**
 * Run a synchronous parser and convert its errors into a user-facing
 * ImportError, so actionable messages (e.g. "Invalid CSV headers. Expected …
 * but received …") reach the client instead of a generic "Import failed".
 */
function parseImport<T>(parse: () => T): T {
  try {
    return parse();
  } catch (error) {
    throw new ImportError(
      error instanceof Error ? error.message : "Invalid file"
    );
  }
}

function assertRowLimit(count: number, locale: SiteLocale) {
  if (count > MAX_IMPORT_ROWS) {
    throw new ImportError(
      t(
        locale,
        `Zu viele Zeilen (${count}). Maximal ${MAX_IMPORT_ROWS} pro Import – bitte die Datei aufteilen.`,
        `Too many rows (${count}). The maximum is ${MAX_IMPORT_ROWS} per import — please split the file.`
      ),
      413
    );
  }
}

/**
 * Enforce per-language access: managers may write any language, translators
 * only the language(s) they are assigned to. Mirrors the project access policy
 * used elsewhere so import can't be used to bypass language scoping.
 */
function assertLanguagesAllowed(
  access: ProjectAccessContext,
  langTos: Iterable<string>,
  locale: SiteLocale
) {
  for (const langTo of new Set(langTos)) {
    if (!canAccessProjectLanguage(access, langTo)) {
      throw new ImportError(
        t(
          locale,
          `Keine Berechtigung für die Sprache "${langTo}".`,
          `You are not authorized for the language "${langTo}".`
        ),
        403
      );
    }
  }
}

async function projectHasWebhookEndpoints(projectId: string) {
  const count = await db.webhookEndpoint.count({
    where: { projectId, enabled: true },
  });
  return count > 0;
}

/**
 * Run `handler` over every item, chunked into separate short transactions.
 *
 * Each chunk commits independently — that is what keeps any single transaction
 * short. The trade-off is that the whole import is not atomic: if a later chunk
 * fails, earlier chunks stay committed. Because every write is an upsert keyed
 * by a stable hash, re-running the import is safe and converges, so on failure
 * we report how many rows were already written instead of leaving the caller
 * to guess whether data was mutated.
 */
async function writeInChunks<T>(
  items: readonly T[],
  locale: SiteLocale,
  handler: (item: T, tx: Prisma.TransactionClient) => Promise<void>
) {
  let committed = 0;
  for (const slice of chunk(items, IMPORT_CHUNK_SIZE)) {
    try {
      await db.$transaction(async (tx) => {
        for (const item of slice) {
          await handler(item, tx);
        }
      }, IMPORT_TX_OPTIONS);
    } catch (error) {
      console.error(
        `[import] chunk failed after ${committed} committed rows:`,
        error
      );
      throw new ImportError(
        t(
          locale,
          `Import nach ${committed} Zeilen abgebrochen. Bereits importierte Zeilen bleiben gespeichert – ein erneuter Import ist sicher und aktualisiert vorhandene Zeilen.`,
          `Import stopped after ${committed} rows. Rows imported so far are kept — re-running the import is safe and updates existing rows.`
        )
      );
    }
    committed += slice.length;
  }
}

type ImportContext = {
  project: Project;
  access: ProjectAccessContext;
  locale: SiteLocale;
  emitRowEvents: boolean;
};

async function importTranslationsPo(
  content: string,
  langTo: string,
  { project, access, locale, emitRowEvents }: ImportContext
) {
  if (!langTo) {
    throw new ImportError(
      t(
        locale,
        "PO-Import benötigt asset=translations und langTo",
        "PO import requires asset=translations and langTo"
      )
    );
  }

  const rows = parseImport(() => parsePoTranslations(content));
  assertRowLimit(rows.length, locale);
  assertLanguagesAllowed(access, [langTo], locale);

  for (const row of rows) {
    if (!row.originalText || !row.translatedText) {
      throw new ImportError(
        t(locale, "PO-Datei enthält leere Einträge", "PO file contains empty entries")
      );
    }
  }

  await writeInChunks(rows, locale, async (row, tx) => {
    const originalHash = computeTranslationHash(
      row.originalText,
      project.originalLang,
      langTo
    );
    const existing = await tx.translation.findUnique({
      where: { projectId_originalHash: { projectId: project.id, originalHash } },
      select: { id: true },
    });
    const translation = await tx.translation.upsert({
      where: { projectId_originalHash: { projectId: project.id, originalHash } },
      create: {
        projectId: project.id,
        originalHash,
        originalText: row.originalText,
        translatedText: row.translatedText,
        langFrom: project.originalLang,
        langTo,
        isManual: true,
        source: "IMPORT",
        wordCount: countWords(row.originalText),
      },
      update: {
        translatedText: row.translatedText,
        langFrom: project.originalLang,
        langTo,
        isManual: true,
        source: "IMPORT",
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
        tx
      );
    }
  });

  const totalWords = rows.reduce((sum, row) => sum + countWords(row.originalText), 0);
  await recordTranslationBatch({
    organizationId: project.organizationId,
    projectId: project.id,
    langFrom: project.originalLang,
    langTo,
    provider: "import",
    totalWords,
    cachedWords: 0,
    manualWords: totalWords,
    glossaryWords: 0,
    translatedWords: 0,
  });

  await queueProjectWebhookEvent({
    projectId: project.id,
    eventType: "import.completed",
    payload: {
      type: "import.completed",
      asset: "translations",
      format: "po",
      importedRows: rows.length,
    },
  });

  return { importedRows: rows.length };
}

async function importTranslationsCsv(
  content: string,
  { project, access, locale, emitRowEvents }: ImportContext
) {
  const rows = parseImport(() => parseTranslationsCsv(content));
  assertRowLimit(rows.length, locale);
  assertLanguagesAllowed(
    access,
    rows.map((row) => row.langTo),
    locale
  );

  for (const row of rows) {
    if (!row.originalText || !row.translatedText) {
      throw new ImportError(
        t(
          locale,
          `Zeile ${row.line}: Übersetzungsdaten unvollständig`,
          `Line ${row.line}: translation data is incomplete`
        )
      );
    }
  }

  await writeInChunks(rows, locale, async (row, tx) => {
    const originalHash = computeTranslationHash(
      row.originalText,
      row.langFrom,
      row.langTo
    );
    const existing = await tx.translation.findUnique({
      where: { projectId_originalHash: { projectId: project.id, originalHash } },
      select: { id: true },
    });
    const translation = await tx.translation.upsert({
      where: { projectId_originalHash: { projectId: project.id, originalHash } },
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
        tx
      );
    }
  });

  // Attribute imported words per language pair instead of lumping everything
  // under the first row's languages.
  const wordsByPair = new Map<
    string,
    { langFrom: string; langTo: string; words: number }
  >();
  for (const row of rows) {
    const key = `${row.langFrom} ${row.langTo}`;
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

async function importGlossaryCsv(
  content: string,
  { project, access, locale, emitRowEvents }: ImportContext
) {
  const rows = parseImport(() => parseGlossaryCsv(content));
  assertRowLimit(rows.length, locale);
  assertLanguagesAllowed(
    access,
    rows.map((row) => row.langTo),
    locale
  );

  for (const row of rows) {
    if (!row.originalTerm || !row.translatedTerm) {
      throw new ImportError(
        t(
          locale,
          `Zeile ${row.line}: Glossardaten unvollständig`,
          `Line ${row.line}: glossary data is incomplete`
        )
      );
    }
  }

  await writeInChunks(rows, locale, async (row, tx) => {
    const glossaryRule = await tx.glossaryRule.upsert({
      where: {
        projectId_originalTerm_langFrom_langTo: {
          projectId: project.id,
          originalTerm: row.originalTerm,
          langFrom: row.langFrom,
          langTo: row.langTo,
        },
      },
      create: {
        projectId: project.id,
        originalTerm: row.originalTerm,
        translatedTerm: row.translatedTerm,
        langFrom: row.langFrom,
        langTo: row.langTo,
        caseSensitive: row.caseSensitive,
      },
      update: {
        translatedTerm: row.translatedTerm,
        caseSensitive: row.caseSensitive,
      },
    });

    if (emitRowEvents) {
      await queueProjectWebhookEvent(
        {
          projectId: project.id,
          eventType: "glossary.upserted",
          payload: {
            type: "glossary.upserted",
            ruleId: glossaryRule.id,
            originalTerm: glossaryRule.originalTerm,
            translatedTerm: glossaryRule.translatedTerm,
            langFrom: glossaryRule.langFrom,
            langTo: glossaryRule.langTo,
            imported: true,
          },
        },
        tx
      );
    }
  });

  await queueProjectWebhookEvent({
    projectId: project.id,
    eventType: "import.completed",
    payload: {
      type: "import.completed",
      asset: "glossary",
      format: "csv",
      importedRows: rows.length,
    },
  });

  return { importedRows: rows.length };
}

async function importSlugsCsv(
  content: string,
  { project, access, locale, emitRowEvents }: ImportContext
) {
  const rows = parseImport(() => parseSlugsCsv(content));
  assertRowLimit(rows.length, locale);
  assertLanguagesAllowed(
    access,
    rows.map((row) => row.langTo),
    locale
  );

  for (const row of rows) {
    if (!row.originalSlug) {
      throw new ImportError(
        t(
          locale,
          `Zeile ${row.line}: Slug-Daten unvollständig`,
          `Line ${row.line}: slug data is incomplete`
        )
      );
    }
  }

  await writeInChunks(rows, locale, async (row, tx) => {
    const slug = await tx.urlSlug.upsert({
      where: {
        projectId_originalSlug_langTo: {
          projectId: project.id,
          originalSlug: row.originalSlug,
          langTo: row.langTo,
        },
      },
      create: {
        projectId: project.id,
        originalSlug: row.originalSlug,
        translatedSlug: row.translatedSlug || null,
        langTo: row.langTo,
        urlCount: row.urlCount,
      },
      update: {
        translatedSlug: row.translatedSlug || null,
        urlCount: row.urlCount,
      },
    });

    if (emitRowEvents) {
      await queueProjectWebhookEvent(
        {
          projectId: project.id,
          eventType: "slug.upserted",
          payload: {
            type: "slug.upserted",
            slugId: slug.id,
            originalSlug: slug.originalSlug,
            translatedSlug: slug.translatedSlug,
            langTo: slug.langTo,
            imported: true,
          },
        },
        tx
      );
    }
  });

  await queueProjectWebhookEvent({
    projectId: project.id,
    eventType: "import.completed",
    payload: {
      type: "import.completed",
      asset: "slugs",
      format: "csv",
      importedRows: rows.length,
    },
  });

  return { importedRows: rows.length };
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ projektId: string }> }
) {
  const locale = await getCookieLocale();
  const userId = await getAuthenticatedUserId();
  const { projektId } = await params;

  if (!userId) {
    return NextResponse.json(
      { error: t(locale, "Nicht authentifiziert", "Not authenticated") },
      { status: 401 }
    );
  }

  const access = await getProjectAccess(userId, projektId);
  if (!access || !canAccessProject(access)) {
    return NextResponse.json(
      { error: t(locale, "Projekt nicht gefunden", "Project not found") },
      { status: 404 }
    );
  }

  const formData = await request.formData();
  const asset = String(formData.get("asset") ?? "translations");
  const format = String(formData.get("format") ?? "csv");
  const file = formData.get("file");
  const poLangTo = String(formData.get("langTo") ?? "").toLowerCase();

  if (!(file instanceof File)) {
    return NextResponse.json(
      { error: t(locale, "Datei fehlt", "Missing file") },
      { status: 400 }
    );
  }

  const project = await db.project.findUnique({
    where: { id: projektId },
  });

  if (!project) {
    return NextResponse.json(
      { error: t(locale, "Projekt nicht gefunden", "Project not found") },
      { status: 404 }
    );
  }

  const content = await file.text();
  const context: ImportContext = {
    project,
    access,
    locale,
    emitRowEvents: await projectHasWebhookEndpoints(project.id),
  };

  try {
    let result: { importedRows: number };

    if (format === "po") {
      if (asset !== "translations") {
        throw new ImportError(
          t(
            locale,
            "PO-Import benötigt asset=translations und langTo",
            "PO import requires asset=translations and langTo"
          )
        );
      }
      result = await importTranslationsPo(content, poLangTo, context);
    } else if (format !== "csv") {
      throw new ImportError(
        t(locale, "Unbekanntes Import-Format", "Unknown import format")
      );
    } else if (asset === "translations") {
      result = await importTranslationsCsv(content, context);
    } else if (asset === "glossary") {
      result = await importGlossaryCsv(content, context);
    } else if (asset === "slugs") {
      result = await importSlugsCsv(content, context);
    } else {
      throw new ImportError(
        t(locale, "Ungültiger Import-Typ", "Invalid import asset")
      );
    }

    return NextResponse.json({ ok: true, ...result });
  } catch (error) {
    if (error instanceof ImportError) {
      return NextResponse.json(
        { error: error.message },
        { status: error.status }
      );
    }

    // Surface database transaction timeouts as an actionable message instead of
    // a raw Prisma error string.
    const message = error instanceof Error ? error.message : "";
    if (/transaction|timed out|timeout|P2028/i.test(message)) {
      return NextResponse.json(
        {
          error: t(
            locale,
            `Import zu groß oder Zeitüberschreitung. Bitte die Datei in kleinere Teile aufteilen (max. ${MAX_IMPORT_ROWS} Zeilen).`,
            `Import too large or timed out. Split the file into smaller parts (max ${MAX_IMPORT_ROWS} rows).`
          ),
        },
        { status: 400 }
      );
    }

    console.error("[POST /api/projects/:projektId/import] Failed:", error);
    return NextResponse.json(
      { error: t(locale, "Import fehlgeschlagen", "Import failed") },
      { status: 400 }
    );
  }
}
