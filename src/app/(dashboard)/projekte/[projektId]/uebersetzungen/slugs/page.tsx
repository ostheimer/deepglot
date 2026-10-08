import { db } from "@/lib/db";
import { notFound } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Search } from "lucide-react";
import { auth } from "@/lib/auth";
import { canManageProject, getProjectAccess } from "@/lib/project-access";
import { selectReadableSlugLanguages } from "@/lib/url-slug-access";
import { SlugRowEditor } from "@/components/projekte/slug-row-editor";
import Link from "next/link";
import {
  buildProjectQueryHref,
  normalizeProjectLang,
} from "@/lib/dashboard-query";
import { formatNumber } from "@/lib/locale-formatting";
import { getRequestLocale } from "@/lib/request-locale";
import { uiText } from "@/lib/static-copy";

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

  const session = await auth();
  const access = session?.user?.id ? await getProjectAccess(session.user.id, projektId) : null;
  if (!access) notFound();
  const readableLanguages = selectReadableSlugLanguages(access, project.languages);
  if (readableLanguages.length === 0) notFound();
  if (lang && !readableLanguages.some((language) => language.langCode.toLowerCase() === lang.toLowerCase())) notFound();
  const activeLang = normalizeProjectLang(
    lang,
    readableLanguages.map((language) => language.langCode)
  );
  const canEdit = canManageProject(access);

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
          {uiText(locale, "URL slugs for", "URL Slugs für")}{" "}
          <span className="text-brand-600">
            {activeLang.charAt(0).toUpperCase() + activeLang.slice(1)}
          </span>
        </h2>
      </div>

      <p className="mb-4 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
        {locale === "de"
          ? "Die Änderung wird beim nächsten Abgleich des WordPress-Plugins aktiv. Für den bisherigen übersetzten Pfad wird keine Weiterleitung erstellt."
          : "The change becomes active after the next WordPress plugin sync. No redirect is created for the previous translated path."}
      </p>

      {/* Language selector */}
      <div className="flex gap-1 border border-gray-200 rounded-lg p-1 bg-white w-fit mb-4">
        {readableLanguages.map((l) => (
          <Button
            key={l.id}
            asChild
            variant="ghost"
            size="sm"
            className={`h-8 px-3 text-xs font-medium transition-colors ${
              activeLang === l.langCode
                ? "bg-brand-600 text-white hover:bg-brand-600 hover:text-white"
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
            placeholder={uiText(locale, "Search slug...", "Slug suchen...")}
            className="pl-9 h-9"
          />
          <input type="hidden" name="lang" value={activeLang} />
        </form>
        <span className="text-sm text-gray-500">
          {formatNumber(total, locale)} {uiText(locale, "results", "Ergebnisse")}
        </span>
      </div>

      {/* Table */}
      <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
        <div className="grid grid-cols-[2fr_2fr] gap-4 px-6 py-3 bg-gray-50 border-b border-gray-200">
          <span className="text-xs font-semibold text-gray-500 uppercase tracking-wider">
            {uiText(locale, "ORIGINAL SLUG", "ORIGINAL-SLUG")}
          </span>
          <span className="text-xs font-semibold text-gray-500 uppercase tracking-wider">
            {uiText(locale, "TRANSLATED SLUG", "ÜBERSETZTER SLUG")}
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
                    ? "Keine URL-Slugs vorhanden. Mappings können per CSV importiert werden."
                    : "No URL slugs yet. Mappings can be imported by CSV."}
            </p>
          </div>
        ) : (
          slugs.map((slug) => (
            <div
              key={slug.id}
              data-slug-id={slug.id}
              data-slug-updated-at={slug.updatedAt.toISOString()}
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
                {canEdit ? (
                  <SlugRowEditor projectId={projektId} initialSlug={{ id: slug.id, originalSlug: slug.originalSlug, translatedSlug: slug.translatedSlug, updatedAt: slug.updatedAt.toISOString() }} locale={locale} />
                ) : slug.translatedSlug ? (
                  <p className="text-sm font-medium text-gray-900">{slug.translatedSlug}</p>
                ) : (
                  <p className="text-sm text-gray-400">{locale === "de" ? "Kein Mapping" : "No mapping"}</p>
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
            {uiText(locale, "Page", "Seite")} {page} {locale === "de" ? "von" : "of"} {totalPages}
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
                  {uiText(locale, "Previous", "Zurück")}
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
                  {uiText(locale, "Next", "Weiter")}
                </Link>
              </Button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
