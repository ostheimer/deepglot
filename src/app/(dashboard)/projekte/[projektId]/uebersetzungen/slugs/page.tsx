import { db } from "@/lib/db";
import { notFound } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Search, Plus, Zap } from "lucide-react";
import Link from "next/link";

interface PageProps {
  params: Promise<{ projektId: string }>;
  searchParams: Promise<{ q?: string; lang?: string; seite?: string }>;
}

export default async function SlugsPage({ params, searchParams }: PageProps) {
  const { projektId } = await params;
  const { q, lang, seite } = await searchParams;

  const page = Math.max(1, parseInt(seite ?? "1", 10));
  const pageSize = 25;

  const project = await db.project.findUnique({
    where: { id: projektId },
    include: { languages: true },
  });

  if (!project) notFound();

  const activeLang = lang ?? project.languages[0]?.langCode ?? "en";

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
          URL Slugs für{" "}
          <span className="text-indigo-600">
            {activeLang.charAt(0).toUpperCase() + activeLang.slice(1)}
          </span>
          {" "}▾
        </h2>
        <div className="flex gap-2">
          <Button variant="outline" size="sm">Filter ▾</Button>
          <Button variant="outline" size="sm">Aktionen ▾</Button>
          <Button className="bg-indigo-600 hover:bg-indigo-700" size="sm">
            <Plus className="mr-2 h-4 w-4" />
            Slug hinzufügen
          </Button>
        </div>
      </div>

      {/* Language selector */}
      <div className="flex gap-1 border border-gray-200 rounded-lg p-1 bg-white w-fit mb-4">
        {project.languages.map((l) => (
          <Link key={l.id} href={`?lang=${l.langCode}`}>
            <button
              className={`px-3 py-1.5 rounded text-xs font-medium transition-colors ${
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

      {/* Search */}
      <div className="flex items-center gap-3 mb-4">
        <form className="flex-1 max-w-xs relative" method="get">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
          <Input
            name="q"
            defaultValue={q}
            placeholder="Slug suchen..."
            className="pl-9 h-9"
          />
          <input type="hidden" name="lang" value={activeLang} />
        </form>
        <span className="text-sm text-gray-500">
          {total.toLocaleString("de-DE")} Ergebnisse
        </span>
      </div>

      {/* Table */}
      <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
        <div className="grid grid-cols-[2fr_2fr_auto] gap-4 px-6 py-3 bg-gray-50 border-b border-gray-200">
          <span className="text-xs font-semibold text-gray-500 uppercase tracking-wider">
            ORIGINAL-SLUG
          </span>
          <span className="text-xs font-semibold text-gray-500 uppercase tracking-wider">
            ÜBERSETZTER SLUG
          </span>
          <span></span>
        </div>

        {slugs.length === 0 ? (
          <div className="px-6 py-16 text-center">
            <p className="text-gray-500 text-sm">
              {q
                ? `Keine Slugs gefunden für "${q}"`
                : "Keine URL-Slugs gefunden. Das Plugin extrahiert Slugs automatisch beim ersten Seitenaufruf."}
            </p>
          </div>
        ) : (
          slugs.map((slug) => (
            <div
              key={slug.id}
              className="grid grid-cols-[2fr_2fr_auto] gap-4 px-6 py-3.5 border-b border-gray-100 last:border-0 items-center hover:bg-gray-50 group transition-colors"
            >
              <div>
                <p className="text-sm font-medium text-gray-900">{slug.originalSlug}</p>
                {slug.urlCount > 0 && (
                  <p className="text-xs text-gray-400 mt-0.5">
                    In {slug.urlCount} URLs gefunden
                  </p>
                )}
              </div>

              <div className="relative">
                <Input
                  defaultValue={slug.translatedSlug ?? ""}
                  placeholder={slug.originalSlug}
                  className="h-8 text-sm pr-28"
                />
              </div>

              <Button
                variant="ghost"
                size="sm"
                className="text-indigo-600 hover:text-indigo-700 hover:bg-indigo-50 h-8 text-xs gap-1.5"
              >
                <Zap className="h-3.5 w-3.5" />
                Auto-Übersetzen
              </Button>
            </div>
          ))
        )}
      </div>

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-between mt-4">
          <p className="text-sm text-gray-500">Seite {page} von {totalPages}</p>
          <div className="flex gap-2">
            {page > 1 && (
              <Link href={`?lang=${activeLang}&seite=${page - 1}${q ? `&q=${q}` : ""}`}>
                <Button variant="outline" size="sm">Zurück</Button>
              </Link>
            )}
            {page < totalPages && (
              <Link href={`?lang=${activeLang}&seite=${page + 1}${q ? `&q=${q}` : ""}`}>
                <Button variant="outline" size="sm">Weiter</Button>
              </Link>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
