import { NextRequest, NextResponse } from "next/server";

import { db } from "@/lib/db";
import {
  serializeGlossaryCsv,
  serializePoTranslations,
  serializeSlugsCsv,
  serializeTranslationsCsv,
} from "@/lib/import-export";
import { getAuthenticatedUserId, userHasProjectAccess } from "@/lib/project-access";
import { getCookieLocale } from "@/lib/request-locale";

function t(locale: "en" | "de", deText: string, enText: string) {
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

  if (!(await userHasProjectAccess(userId, projektId))) {
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

    return new Response(po, {
      headers: {
        "Content-Type": "text/plain; charset=utf-8",
        "Content-Disposition": `attachment; filename="deepglot-${asset}-${langTo}.po"`,
      },
    });
  }

  if (asset === "translations") {
    const translations = await db.translation.findMany({
      where: { projectId: projektId },
      orderBy: [{ langTo: "asc" }, { originalText: "asc" }],
    });
    const csv = serializeTranslationsCsv(
      translations.map((translation) => ({
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
        "Content-Disposition": `attachment; filename="deepglot-${asset}.csv"`,
      },
    });
  }

  if (asset === "glossary") {
    const rules = await db.glossaryRule.findMany({
      where: { projectId: projektId },
      orderBy: [{ langTo: "asc" }, { originalTerm: "asc" }],
    });
    const csv = serializeGlossaryCsv(
      rules.map((rule) => ({
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
        "Content-Disposition": `attachment; filename="deepglot-${asset}.csv"`,
      },
    });
  }

  if (asset === "slugs") {
    const slugs = await db.urlSlug.findMany({
      where: { projectId: projektId },
      orderBy: [{ langTo: "asc" }, { originalSlug: "asc" }],
    });
    const csv = serializeSlugsCsv(
      slugs.map((slug) => ({
        originalSlug: slug.originalSlug,
        translatedSlug: slug.translatedSlug ?? "",
        langTo: slug.langTo,
        urlCount: slug.urlCount,
      }))
    );

    return new Response(csv, {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="deepglot-${asset}.csv"`,
      },
    });
  }

  return NextResponse.json(
    { error: t(locale, "Ungültiger Export-Typ", "Invalid export asset") },
    { status: 400 }
  );
}
