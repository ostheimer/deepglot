import { db } from "@/lib/db";
import { notFound } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Search } from "lucide-react";
import Link from "next/link";
import {
  buildProjectQueryHref,
  normalizeProjectLang,
} from "@/lib/dashboard-query";
import { formatNumber } from "@/lib/locale-formatting";
import { getRequestLocale } from "@/lib/request-locale";

interface PageProps {
  params: Promise<{ projektId: string }>;
  searchParams: Promise<{ q?: string; lang?: string; seite?: string }>;
}

export default async function SlugsPage({ params, searchParams }: PageProps) {
  const { projektId } = await params;
  const { q, lang, seite } = await searchParams;
  const locale = await getRequestLocale();

  const page = Math.max(1, parseInt(seite ?? "1", 10));
  const pageSize = 25;

  const project = await db.project.findUnique({
    where: { id: projektId },
    include: { languages: true },
  });

  if (!project) notFound();

  const activeLang = normalizeProjectLang(
    lang,
    project.languages.map((language) => language.langCode)
  );

  const where = {
    projectId: projektId,
    langTo: activeLang,
    ...(q ? { originalSlug: { contains: q, mode: "insensitive" as const } } : {}),
  };

  const [slugs, total] = await Promise.all([
    db.urlSlug.findMany({
      where,
      orderBy: { urlCount: "desc" },
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
    db.urlSlug.count({ where }),
  ]);

  const totalPages = Math.ceil(total / pageSize);

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h2 className="text-xl font-bold text-gray-900">
          {locale === "de" ? "URL Slugs für" : "URL slugs for"}{" "}
          <span className="text-indigo-600">
            {activeLang.charAt(0).toUpperCase() + activeLang.slice(1)}
          </span>
        </h2>
      </div>

      <p className="mb-4 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
        {locale === "de"
          ? "Slug-Bearbeitung ist hier noch nicht verfügbar. Das Plugin erkennt Slugs automatisch; Import und Export bleiben der sichere Weg für manuelle Slug-Änderungen."
          : "Slug editing is not available here yet. The plugin detects slugs automatically; import and export remain the safe path for manual slug changes."}
      </p>

      {/* Language selector */}
      <div className="flex gap-1 border border-gray-200 rounded-lg p-1 bg-white w-fit mb-4">
        {project.languages.map((l) => (
          <Button
            key={l.id}
            asChild
            variant="ghost"
            size="sm"
            className={`h-8 px-3 text-xs font-medium transition-colors ${
              activeLang === l.langCode
                ? "bg-indigo-600 text-white hover:bg-indigo-600 hover:text-white"
                : "text-gray-600 hover:bg-gray-100"
            }`}
          >
            <Link
              href={buildProjectQueryHref({ lang: l.langCode, q })}
              aria-current={activeLang === l.langCode ? "page" : undefined}
            >
              {l.langCode.toUpperCase()}
            </Link>
          </Button>
        ))}
      </div>

      {/* Search */}
      <div className="flex items-center gap-3 mb-4">
        <form className="flex-1 max-w-xs relative" method="get">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
          <Input
            name="q"
            defaultValue={q}
            placeholder={locale === "de" ? "Slug suchen..." : "Search slug..."}
            className="pl-9 h-9"
          />
          <input type="hidden" name="lang" value={activeLang} />
        </form>
        <span className="text-sm text-gray-500">
          {formatNumber(total, locale)} {locale === "de" ? "Ergebnisse" : "results"}
        </span>
      </div>

      {/* Table */}
      <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
        <div className="grid grid-cols-[2fr_2fr] gap-4 px-6 py-3 bg-gray-50 border-b border-gray-200">
          <span className="text-xs font-semibold text-gray-500 uppercase tracking-wider">
            {locale === "de" ? "ORIGINAL-SLUG" : "ORIGINAL SLUG"}
          </span>
          <span className="text-xs font-semibold text-gray-500 uppercase tracking-wider">
            {locale === "de" ? "ÜBERSETZTER SLUG" : "TRANSLATED SLUG"}
          </span>
        </div>

        {slugs.length === 0 ? (
          <div className="px-6 py-16 text-center">
            <p className="text-gray-500 text-sm">
              {q
                ? locale === "de"
                  ? `Keine Slugs gefunden für "${q}"`
                  : `No slugs found for "${q}"`
                : locale === "de"
                  ? "Keine URL-Slugs gefunden. Das Plugin extrahiert Slugs automatisch beim ersten Seitenaufruf."
                  : "No URL slugs found. The plugin extracts slugs automatically the first time a page is opened."}
            </p>
          </div>
        ) : (
          slugs.map((slug) => (
            <div
              key={slug.id}
              className="grid grid-cols-[2fr_2fr] gap-4 px-6 py-3.5 border-b border-gray-100 last:border-0 items-center hover:bg-gray-50 group transition-colors"
            >
              <div>
                <p className="text-sm font-medium text-gray-900">{slug.originalSlug}</p>
                {slug.urlCount > 0 && (
                  <p className="text-xs text-gray-400 mt-0.5">
                    {locale === "de"
                      ? `In ${slug.urlCount} URLs gefunden`
                      : `Found in ${slug.urlCount} URLs`}
                  </p>
                )}
              </div>

              <div>
                {slug.translatedSlug ? (
                  <p className="text-sm font-medium text-gray-900">{slug.translatedSlug}</p>
                ) : (
                  <p className="text-sm text-gray-400">
                    {locale === "de" ? "Wird automatisch generiert" : "Generated automatically"}
                  </p>
                )}
              </div>
            </div>
          ))
        )}
      </div>

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-between mt-4">
          <p className="text-sm text-gray-500">
            {locale === "de" ? "Seite" : "Page"} {page} {locale === "de" ? "von" : "of"} {totalPages}
          </p>
          <div className="flex gap-2">
            {page > 1 && (
              <Button asChild variant="outline" size="sm">
                <Link
                  href={buildProjectQueryHref({
                    lang: activeLang,
                    page: page - 1,
                    q,
                  })}
                >
                  {locale === "de" ? "Zurück" : "Previous"}
                </Link>
              </Button>
            )}
            {page < totalPages && (
              <Button asChild variant="outline" size="sm">
                <Link
                  href={buildProjectQueryHref({
                    lang: activeLang,
                    page: page + 1,
                    q,
                  })}
                >
                  {locale === "de" ? "Weiter" : "Next"}
                </Link>
              </Button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
