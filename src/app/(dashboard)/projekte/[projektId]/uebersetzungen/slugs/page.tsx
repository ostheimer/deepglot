import { db } from "@/lib/db";
import { notFound } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Search } from "lucide-react";
import { auth } from "@/lib/auth";
import { canManageProject, getProjectAccess } from "@/lib/project-access";
import { selectReadableSlugLanguages } from "@/lib/url-slug-access";
import { SlugList } from "@/components/projekte/slug-list";
import Link from "next/link";
import {
  normalizeProjectLang,
} from "@/lib/dashboard-query";
import { formatNumber } from "@/lib/locale-formatting";
import { getRequestLocale } from "@/lib/request-locale";
import { uiText } from "@/lib/static-copy";

interface PageProps {
  params: Promise<{ projektId: string }>;
  searchParams: Promise<{ q?: string; lang?: string; seite?: string; status?: string }>;
}

export default async function SlugsPage({ params, searchParams }: PageProps) {
  const { projektId } = await params;
  const { q, lang, seite, status } = await searchParams;
  const locale = await getRequestLocale();

  const page = Math.max(1, Number.parseInt(seite ?? "1", 10) || 1);
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
  const activeStatus = status === "translated" || status === "untranslated" ? status : "all";
  const href = (options: { lang?: string; page?: number; q?: string; status?: string }) => {
    const query = new URLSearchParams({ lang: options.lang ?? activeLang });
    if (options.page && options.page > 1) query.set("seite", String(options.page));
    if (options.q ?? q) query.set("q", options.q ?? q ?? "");
    if ((options.status ?? activeStatus) !== "all") query.set("status", options.status ?? activeStatus);
    return `?${query.toString()}`;
  };

  const where = {
    projectId: projektId,
    langTo: activeLang,
    ...(q ? { OR: [
      { originalSlug: { contains: q, mode: "insensitive" as const } },
      { translatedSlug: { contains: q, mode: "insensitive" as const } },
    ] } : {}),
    ...(activeStatus === "translated" ? { translatedSlug: { not: null } } : {}),
    ...(activeStatus === "untranslated" ? { translatedSlug: null } : {}),
  };

  const [slugs, total] = await Promise.all([
    db.urlSlug.findMany({
      where,
      orderBy: [{ urlCount: "desc" }, { originalSlug: "asc" }],
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
              href={href({ lang: l.langCode, q })}
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
          {activeStatus !== "all" && <input type="hidden" name="status" value={activeStatus} />}
        </form>
        <span className="text-sm text-gray-500">
          {formatNumber(total, locale)} {uiText(locale, "results", "Ergebnisse")}
        </span>
      </div>

      <div className="mb-4 flex flex-wrap gap-2" aria-label={locale === "de" ? "Übersetzungsstatus" : "Translation status"}>
        {(["all", "translated", "untranslated"] as const).map((value) => (
          <Button key={value} asChild variant={activeStatus === value ? "default" : "outline"} size="sm">
            <Link href={href({ status: value })} aria-current={activeStatus === value ? "page" : undefined}>
              {locale === "de" ? ({ all: "Alle", translated: "Übersetzt", untranslated: "Unübersetzt" }[value]) : ({ all: "All", translated: "Translated", untranslated: "Untranslated" }[value])}
            </Link>
          </Button>
        ))}
      </div>

      {/* Table */}
      {slugs.length === 0 ? (
        <p className="rounded-xl border border-gray-200 bg-white px-6 py-12 text-center text-sm text-gray-500">
          {locale === "de" ? "Keine URL-Slugs für diese Suche und diesen Status gefunden." : "No URL slugs found for this search and status."}
        </p>
      ) : (
        <SlugList key={JSON.stringify([activeLang, activeStatus, q ?? "", page, slugs.map((slug) => [slug.id, slug.updatedAt.toISOString()])])} rows={slugs.map((slug) => ({ ...slug, updatedAt: slug.updatedAt.toISOString() }))} projectId={projektId} canEdit={canEdit} locale={locale} />
      )}

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
                  href={href({ page: page - 1 })}
                >
                  {uiText(locale, "Previous", "Zurück")}
                </Link>
              </Button>
            )}
            {page < totalPages && (
              <Button asChild variant="outline" size="sm">
                <Link
                  href={href({ page: page + 1 })}
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
