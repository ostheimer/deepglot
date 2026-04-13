import { db } from "@/lib/db";
import { notFound } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Search, RefreshCw, Trash2, ChevronRight } from "lucide-react";
import Link from "next/link";
import { formatNumber } from "@/lib/locale-formatting";
import { getRequestLocale } from "@/lib/request-locale";

interface PageProps {
  params: Promise<{ projektId: string }>;
  searchParams: Promise<{ q?: string; lang?: string; seite?: string }>;
}

export default async function UrlsPage({ params, searchParams }: PageProps) {
  const { projektId } = await params;
  const { q, lang, seite } = await searchParams;
  const locale = await getRequestLocale();

  const page = Math.max(1, parseInt(seite ?? "1", 10));
  const pageSize = 20;

  const project = await db.project.findUnique({
    where: { id: projektId },
    include: { languages: true },
  });

  if (!project) notFound();

  const activeLang = lang ?? project.languages[0]?.langCode ?? "en";

  const where = {
    projectId: projektId,
    langTo: activeLang,
    ...(q ? { urlPath: { contains: q, mode: "insensitive" as const } } : {}),
  };

  const [urlRecords, total] = await Promise.all([
    db.translatedUrl.findMany({
      where,
      orderBy: { requestCount: "desc" },
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
    db.translatedUrl.count({ where }),
  ]);

  const totalPages = Math.ceil(total / pageSize);

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h2 className="text-xl font-bold text-gray-900">
          {locale === "de" ? "Übersetzungen nach URLs" : "Translations by URL"}
        </h2>
        <div className="flex gap-2 items-center">
          {/* Language filter */}
          <div className="flex gap-1 border border-gray-200 rounded-lg p-1 bg-white">
            {project.languages.map((l) => (
              <Link key={l.id} href={`?lang=${l.langCode}`}>
                <button
                  className={`px-2.5 py-1 rounded text-xs font-medium transition-colors ${
                    activeLang === l.langCode
                      ? "bg-indigo-600 text-white"
                      : "text-gray-600 hover:bg-gray-100"
                  }`}
                >
                  {l.langCode.toUpperCase()}
                </button>
              </Link>
            ))}
          </div>
        </div>
      </div>

      {/* Search */}
      <div className="flex items-center gap-3 mb-4">
        <form className="flex-1 max-w-xs relative" action="" method="get">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
          <Input
            name="q"
            defaultValue={q}
            placeholder={locale === "de" ? "URL suchen..." : "Search URL..."}
            className="pl-9 h-9"
          />
          {lang && <input type="hidden" name="lang" value={lang} />}
        </form>
        <span className="text-sm text-gray-500">
          {formatNumber(total, locale)} {locale === "de" ? "Ergebnisse" : "results"}
        </span>
        <div className="ml-auto flex items-center gap-2 text-sm text-gray-500">
          <span>{locale === "de" ? "Sortiert nach: Meiste Anfragen" : "Sorted by: most requests"}</span>
        </div>
      </div>

      {/* Table */}
      <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
        <div className="grid grid-cols-[2fr_1fr_1fr_auto] gap-4 px-6 py-3 bg-gray-50 border-b border-gray-200">
          <span className="text-xs font-semibold text-gray-500 uppercase tracking-wider">URL</span>
          <span className="text-xs font-semibold text-gray-500 uppercase tracking-wider flex items-center gap-1">
            🇬🇧 {activeLang.toUpperCase()}
          </span>
          <span className="text-xs font-semibold text-gray-500 uppercase tracking-wider">
            {locale === "de" ? "MANUELL" : "MANUAL"}
          </span>
          <span></span>
        </div>

        {urlRecords.length === 0 ? (
          <div className="px-6 py-16 text-center">
            <p className="text-gray-500 text-sm">
              {q
                ? locale === "de"
                  ? `Keine URLs gefunden für "${q}"`
                  : `No URLs found for "${q}"`
                : locale === "de"
                  ? "Noch keine URL-Übersetzungsanfragen. Richte das WordPress-Plugin ein, um anzufangen."
                  : "No URL translation requests yet. Set up the WordPress plugin to get started."}
            </p>
          </div>
        ) : (
          urlRecords.map((record) => (
            <div
              key={record.id}
              className="grid grid-cols-[2fr_1fr_1fr_auto] gap-4 px-6 py-3.5 border-b border-gray-100 last:border-0 items-center hover:bg-gray-50 group transition-colors"
            >
              {/* URL */}
              <div className="flex items-center gap-2 min-w-0">
                <span className="text-sm text-gray-900 truncate font-medium">
                  {record.urlPath}
                </span>
                <Link
                  href={`https://${project.domain}${record.urlPath}`}
                  target="_blank"
                  className="opacity-0 group-hover:opacity-100 transition-opacity"
                >
                  <ChevronRight className="h-3.5 w-3.5 text-gray-400" />
                </Link>
              </div>

              {/* Word count */}
              <span className="text-sm text-gray-700">
                0/{formatNumber(record.wordCount, locale)}
              </span>

              {/* Manual % */}
              <span className="text-sm text-indigo-600 font-medium">0%</span>

              {/* Actions */}
              <div className="flex items-center gap-1.5 opacity-0 group-hover:opacity-100 transition-opacity">
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-7 w-7 p-0"
                  title={locale === "de" ? "Neu übersetzen" : "Retranslate"}
                >
                  <RefreshCw className="h-3.5 w-3.5 text-gray-400" />
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-7 w-7 p-0"
                  title={locale === "de" ? "Löschen" : "Delete"}
                >
                  <Trash2 className="h-3.5 w-3.5 text-gray-400 hover:text-red-500" />
                </Button>
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
              <Link href={`?lang=${activeLang}&seite=${page - 1}${q ? `&q=${q}` : ""}`}>
                <Button variant="outline" size="sm">{locale === "de" ? "Zurück" : "Previous"}</Button>
              </Link>
            )}
            {page < totalPages && (
              <Link href={`?lang=${activeLang}&seite=${page + 1}${q ? `&q=${q}` : ""}`}>
                <Button variant="outline" size="sm">{locale === "de" ? "Weiter" : "Next"}</Button>
              </Link>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
