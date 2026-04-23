import { NextRequest, NextResponse } from "next/server";

import { db } from "@/lib/db";
import {
  parseGlossaryCsv,
  parsePoTranslations,
  parseSlugsCsv,
  parseTranslationsCsv,
} from "@/lib/import-export";
import { getAuthenticatedUserId, userHasProjectAccess } from "@/lib/project-access";
import { queueProjectWebhookEvent } from "@/lib/project-webhook-delivery";
import { getCookieLocale } from "@/lib/request-locale";
import { recordTranslationBatch } from "@/lib/translation-batches";
import { computeTranslationHash } from "@/lib/translation-hash";

export const runtime = "nodejs";

function t(locale: "en" | "de", deText: string, enText: string) {
  return locale === "de" ? deText : enText;
}

function countWords(text: string) {
  return text.trim().split(/\s+/).filter(Boolean).length;
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

  if (!(await userHasProjectAccess(userId, projektId))) {
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
    include: { organization: true },
  });

  if (!project) {
    return NextResponse.json(
      { error: t(locale, "Projekt nicht gefunden", "Project not found") },
      { status: 404 }
    );
  }

  const content = await file.text();

  try {
    const result = await db.$transaction(async (tx) => {
      if (format === "po") {
        if (asset !== "translations" || !poLangTo) {
          throw new Error(
            t(
              locale,
              "PO-Import benötigt asset=translations und langTo",
              "PO import requires asset=translations and langTo"
            )
          );
        }

        const rows = parsePoTranslations(content);

        for (const row of rows) {
          if (!row.originalText || !row.translatedText) {
            throw new Error(
              t(
                locale,
                "PO-Datei enthält leere Einträge",
                "PO file contains empty entries"
              )
            );
          }

          const originalHash = computeTranslationHash(
            row.originalText,
            project.originalLang,
            poLangTo
          );
          const existing = await tx.translation.findUnique({
            where: {
              projectId_originalHash: {
                projectId: projektId,
                originalHash,
              },
            },
          });
          const translation = await tx.translation.upsert({
            where: {
              projectId_originalHash: {
                projectId: projektId,
                originalHash,
              },
            },
            create: {
              projectId: projektId,
              originalHash,
              originalText: row.originalText,
              translatedText: row.translatedText,
              langFrom: project.originalLang,
              langTo: poLangTo,
              isManual: true,
              source: "IMPORT",
              wordCount: countWords(row.originalText),
            },
            update: {
              translatedText: row.translatedText,
              langFrom: project.originalLang,
              langTo: poLangTo,
              isManual: true,
              source: "IMPORT",
            },
          });

          await queueProjectWebhookEvent(
            {
              projectId: projektId,
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

        await recordTranslationBatch(
          {
            organizationId: project.organizationId,
            projectId: projektId,
            langFrom: project.originalLang,
            langTo: poLangTo,
            provider: "import",
            totalWords: rows.reduce(
              (sum, row) => sum + countWords(row.originalText),
              0
            ),
            cachedWords: 0,
            manualWords: rows.reduce(
              (sum, row) => sum + countWords(row.originalText),
              0
            ),
            glossaryWords: 0,
            translatedWords: 0,
          },
          tx
        );

        await queueProjectWebhookEvent(
          {
            projectId: projektId,
            eventType: "import.completed",
            payload: {
              type: "import.completed",
              asset,
              format,
              importedRows: rows.length,
            },
          },
          tx
        );

        return { importedRows: rows.length };
      }

      if (format !== "csv") {
        throw new Error(
          t(locale, "Unbekanntes Import-Format", "Unknown import format")
        );
      }

      if (asset === "translations") {
        const rows = parseTranslationsCsv(content);

        for (const row of rows) {
          if (!row.originalText || !row.translatedText) {
            throw new Error(
              t(
                locale,
                `Zeile ${row.line}: Übersetzungsdaten unvollständig`,
                `Line ${row.line}: translation data is incomplete`
              )
            );
          }

          const originalHash = computeTranslationHash(
            row.originalText,
            row.langFrom,
            row.langTo
          );
          const existing = await tx.translation.findUnique({
            where: {
              projectId_originalHash: {
                projectId: projektId,
                originalHash,
              },
            },
          });
          const translation = await tx.translation.upsert({
            where: {
              projectId_originalHash: {
                projectId: projektId,
                originalHash,
              },
            },
            create: {
              projectId: projektId,
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

          await queueProjectWebhookEvent(
            {
              projectId: projektId,
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

        await recordTranslationBatch(
          {
            organizationId: project.organizationId,
            projectId: projektId,
            langFrom: rows[0]?.langFrom ?? project.originalLang,
            langTo: rows[0]?.langTo ?? project.originalLang,
            provider: "import",
            totalWords: rows.reduce(
              (sum, row) => sum + countWords(row.originalText),
              0
            ),
            cachedWords: 0,
            manualWords: rows.reduce(
              (sum, row) => sum + countWords(row.originalText),
              0
            ),
            glossaryWords: 0,
            translatedWords: 0,
          },
          tx
        );

        await queueProjectWebhookEvent(
          {
            projectId: projektId,
            eventType: "import.completed",
            payload: {
              type: "import.completed",
              asset,
              format,
              importedRows: rows.length,
            },
          },
          tx
        );

        return { importedRows: rows.length };
      }

      if (asset === "glossary") {
        const rows = parseGlossaryCsv(content);

        for (const row of rows) {
          if (!row.originalTerm || !row.translatedTerm) {
            throw new Error(
              t(
                locale,
                `Zeile ${row.line}: Glossardaten unvollständig`,
                `Line ${row.line}: glossary data is incomplete`
              )
            );
          }

          const glossaryRule = await tx.glossaryRule.upsert({
            where: {
              projectId_originalTerm_langFrom_langTo: {
                projectId: projektId,
                originalTerm: row.originalTerm,
                langFrom: row.langFrom,
                langTo: row.langTo,
              },
            },
            create: {
              projectId: projektId,
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

          await queueProjectWebhookEvent(
            {
              projectId: projektId,
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

        await queueProjectWebhookEvent(
          {
            projectId: projektId,
            eventType: "import.completed",
            payload: {
              type: "import.completed",
              asset,
              format,
              importedRows: rows.length,
            },
          },
          tx
        );

        return { importedRows: rows.length };
      }

      if (asset === "slugs") {
        const rows = parseSlugsCsv(content);

        for (const row of rows) {
          if (!row.originalSlug) {
            throw new Error(
              t(
                locale,
                `Zeile ${row.line}: Slug-Daten unvollständig`,
                `Line ${row.line}: slug data is incomplete`
              )
            );
          }

          const slug = await tx.urlSlug.upsert({
            where: {
              projectId_originalSlug_langTo: {
                projectId: projektId,
                originalSlug: row.originalSlug,
                langTo: row.langTo,
              },
            },
            create: {
              projectId: projektId,
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

          await queueProjectWebhookEvent(
            {
              projectId: projektId,
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

        await queueProjectWebhookEvent(
          {
            projectId: projektId,
            eventType: "import.completed",
            payload: {
              type: "import.completed",
              asset,
              format,
              importedRows: rows.length,
            },
          },
          tx
        );

        return { importedRows: rows.length };
      }

      throw new Error(
        t(locale, "Ungültiger Import-Typ", "Invalid import asset")
      );
    });

    return NextResponse.json({ ok: true, ...result });
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : t(locale, "Import fehlgeschlagen", "Import failed"),
      },
      { status: 400 }
    );
  }
}
