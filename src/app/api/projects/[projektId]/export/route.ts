import { NextRequest, NextResponse } from "next/server";

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

function t(locale: SiteLocale, deText: string, enText: string) {
  return uiText(locale, enText, deText);
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
