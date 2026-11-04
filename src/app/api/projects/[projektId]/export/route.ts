import { NextRequest, NextResponse } from "next/server";
import { Prisma } from "@prisma/client";

import { db } from "@/lib/db";
import {
  sanitizeFilenamePart,
  serializeGlossaryCsv,
  serializePoTranslations,
  serializeSlugsCsv,
  serializeTranslationsCsv,
} from "@/lib/import-export";
import {
  canAccessProject,
  canAccessProjectLanguage,
  getAuthenticatedUserId,
  getProjectAccess,
} from "@/lib/project-access";
import { getCookieLocale } from "@/lib/request-locale";
import type { SiteLocale } from "@/lib/site-locale";
import { uiText } from "@/lib/static-copy";
import { serializeXliff, XliffError, XLIFF_MAX_BYTES, XLIFF_MAX_SEGMENTS } from "@/lib/xliff";

function t(locale: SiteLocale, deText: string, enText: string) {
  return uiText(locale, enText, deText);
}

function xliffCopy(locale: SiteLocale, deText: string, enText: string) {
  return locale === "de" ? deText : enText;
}

export async function GET(
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

  const { searchParams } = new URL(request.url);
  const asset = searchParams.get("asset") ?? "translations";
  const format = searchParams.get("format") ?? "csv";
  const langTo = searchParams.get("langTo")?.toLowerCase() ?? "";

  const project = await db.project.findUnique({
    where: { id: projektId },
  });

  if (!project) {
    return NextResponse.json(
      { error: t(locale, "Projekt nicht gefunden", "Project not found") },
      { status: 404 }
    );
  }

  if (format === "po") {
    if (asset !== "translations" || !langTo) {
      return NextResponse.json(
        {
          error: t(
            locale,
            "PO-Export benötigt asset=translations und langTo",
            "PO export requires asset=translations and langTo"
          ),
        },
        { status: 400 }
      );
    }

    // Translators may only export the language(s) they are assigned to;
    // managers may export any. Keeps language scoping consistent with the rest
    // of the project access policy.
    if (!canAccessProjectLanguage(access, langTo)) {
      return NextResponse.json(
        {
          error: t(
            locale,
            `Keine Berechtigung für die Sprache "${langTo}".`,
            `You are not authorized for the language "${langTo}".`
          ),
        },
        { status: 403 }
      );
    }

    const translations = await db.translation.findMany({
      where: {
        projectId: projektId,
        langTo,
      },
      orderBy: { originalText: "asc" },
    });
    const po = serializePoTranslations(
      translations.map((translation) => ({
        originalText: translation.originalText,
        translatedText: translation.translatedText,
      })),
      {
        langFrom: project.originalLang,
        langTo,
      }
    );

    const filename = `deepglot-translations-${sanitizeFilenamePart(langTo)}.po`;
    return new Response(po, {
      headers: {
        "Content-Type": "text/plain; charset=utf-8",
        "Content-Disposition": `attachment; filename="${filename}"`,
      },
    });
  }

  if (format === "xliff") {
    if (asset !== "translations" || !langTo) {
      return NextResponse.json({ error: xliffCopy(locale, "XLIFF-Export benötigt eine Zielsprache", "XLIFF export requires a target language") }, { status: 400 });
    }
    if (!canAccessProjectLanguage(access, langTo)) {
      return NextResponse.json({ error: xliffCopy(locale, "Keine Berechtigung für diese Sprache", "No access to this language") }, { status: 403 });
    }
    const translations = await db.$transaction(async (tx) => {
      const [size] = await tx.$queryRaw<Array<{ rows: bigint; bytes: bigint }>>`
        SELECT COUNT(*)::bigint AS rows,
          COALESCE(SUM(octet_length("originalText") + octet_length("translatedText")), 0)::bigint AS bytes
        FROM "Translation"
        WHERE "projectId" = ${projektId} AND LOWER("langFrom") = ${project.originalLang.toLowerCase()}
          AND LOWER("langTo") = ${langTo}
      `;
      if (size.rows > BigInt(XLIFF_MAX_SEGMENTS) || size.bytes > BigInt(XLIFF_MAX_BYTES)) return null;
      return tx.translation.findMany({
        where: { projectId: projektId,
          langFrom: { equals: project.originalLang, mode: "insensitive" },
          langTo: { equals: langTo, mode: "insensitive" } },
        orderBy: { originalHash: "asc" },
        select: { originalHash: true, originalText: true, translatedText: true, workflowStatus: true,
          isManual: true, langFrom: true, langTo: true },
        take: XLIFF_MAX_SEGMENTS + 1,
      });
    }, { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead, maxWait: 10_000, timeout: 30_000 });
    if (!translations || translations.length > XLIFF_MAX_SEGMENTS) {
      return NextResponse.json({ error: xliffCopy(locale, "XLIFF-Export überschreitet 4 MB oder 5000 Segmente", "XLIFF export exceeds 4 MB or 5000 segments") }, { status: 413 });
    }
    if (new Set(translations.map((item) => item.originalText)).size !== translations.length) {
      return NextResponse.json({ error: xliffCopy(locale,
        "XLIFF-Export enthält denselben Quelltext mit mehreren Sprachcode-Schreibweisen",
        "XLIFF export contains the same source with multiple language-code spellings") }, { status: 409 });
    }
    let xliff: string;
    try { xliff = serializeXliff({ projectId: projektId, langFrom: project.originalLang, langTo, segments: translations }); }
    catch (error) {
      if (error instanceof XliffError) return NextResponse.json({ error: xliffCopy(locale,
        "Eine Übersetzung enthält ein in XML 1.0 nicht unterstütztes Zeichen.",
        "A translation contains a character unsupported by XML 1.0.") }, { status: 422 });
      throw error;
    }
    if (new TextEncoder().encode(xliff).byteLength > XLIFF_MAX_BYTES) {
      return NextResponse.json({ error: xliffCopy(locale, "XLIFF-Export überschreitet 4 MB oder 5000 Segmente", "XLIFF export exceeds 4 MB or 5000 segments") }, { status: 413 });
    }
    return new Response(xliff, { headers: {
      "Content-Type": "application/x-xliff+xml; charset=utf-8",
      "Content-Disposition": `attachment; filename="deepglot-translations-${sanitizeFilenamePart(langTo)}.xlf"`,
    } });
  }

  if (asset === "translations") {
    const translations = await db.translation.findMany({
      where: { projectId: projektId },
      orderBy: [{ langTo: "asc" }, { originalText: "asc" }],
    });
    const csv = serializeTranslationsCsv(
      translations
        .filter((translation) =>
          canAccessProjectLanguage(access, translation.langTo)
        )
        .map((translation) => ({
          originalText: translation.originalText,
          translatedText: translation.translatedText,
          langFrom: translation.langFrom,
          langTo: translation.langTo,
          isManual: translation.isManual,
          source: translation.source,
        }))
    );

    return new Response(csv, {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="deepglot-translations.csv"`,
      },
    });
  }

  if (asset === "glossary") {
    const rules = await db.glossaryRule.findMany({
      where: { projectId: projektId },
      orderBy: [{ langTo: "asc" }, { originalTerm: "asc" }],
    });
    const csv = serializeGlossaryCsv(
      rules
        .filter((rule) => canAccessProjectLanguage(access, rule.langTo))
        .map((rule) => ({
          originalTerm: rule.originalTerm,
          translatedTerm: rule.translatedTerm,
          langFrom: rule.langFrom,
          langTo: rule.langTo,
          caseSensitive: rule.caseSensitive,
        }))
    );

    return new Response(csv, {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="deepglot-glossary.csv"`,
      },
    });
  }

  if (asset === "slugs") {
    const slugs = await db.urlSlug.findMany({
      where: { projectId: projektId },
      orderBy: [{ langTo: "asc" }, { originalSlug: "asc" }],
    });
    const csv = serializeSlugsCsv(
      slugs
        .filter((slug) => canAccessProjectLanguage(access, slug.langTo))
        .map((slug) => ({
          originalSlug: slug.originalSlug,
          translatedSlug: slug.translatedSlug ?? "",
          langTo: slug.langTo,
          urlCount: slug.urlCount,
        }))
    );

    return new Response(csv, {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="deepglot-slugs.csv"`,
      },
    });
  }

  return NextResponse.json(
    { error: t(locale, "Ungültiger Export-Typ", "Invalid export asset") },
    { status: 400 }
  );
}
