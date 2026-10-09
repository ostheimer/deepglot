import { db } from "@/lib/db";
import { notFound } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Search } from "lucide-react";
import Link from "next/link";
import { formatNumber } from "@/lib/locale-formatting";
import { getRequestLocale } from "@/lib/request-locale";
import { getProjectUrl, getWordPressSettingsUrl } from "@/lib/project-url";
import { getAuthenticatedUserId, userCanManageProject } from "@/lib/project-access";
import { UrlOperations } from "@/components/projekte/url-operations";
import {
  buildProjectQueryHref,
  normalizeProjectLang,
} from "@/lib/dashboard-query";
import { uiText } from "@/lib/static-copy";

interface PageProps {
  params: Promise<{ projektId: string }>;
  searchParams: Promise<{ q?: string; lang?: string; seite?: string; status?: string }>;
}

export default async function UrlsPage({ params, searchParams }: PageProps) {
  const { projektId } = await params;
  const { q, lang, seite, status } = await searchParams;
  const locale = await getRequestLocale();
  const userId = await getAuthenticatedUserId();
  if (!userId || !(await userCanManageProject(userId, projektId))) notFound();

  const page = Math.max(1, parseInt(seite ?? "1", 10));
  const pageSize = 20;

  const project = await db.project.findUnique({
    where: { id: projektId },
    include: { languages: true, settings: true, domainMappings: true },
  });

  if (!project) notFound();

  const activeLang = normalizeProjectLang(
    lang,
    project.languages.map((language) => language.langCode)
  );

  const where = {
    projectId: projektId,
    langTo: activeLang,
    ...(status === "failed" ? { operationState: { in: ["failed", "sync_failed", "provider_pending"] } } : {}),
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
  const wordpressSyncUrl = getWordPressSettingsUrl(project.domain, project.settings?.runtimeSyncSiteHost);

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h2 className="text-xl font-bold text-gray-900">
          {uiText(locale, "Translations by URL", "Übersetzungen nach URLs")}
        </h2>
        <div className="flex gap-2 items-center">
          {/* Language filter */}
          <div className="flex gap-1 border border-gray-200 rounded-lg p-1 bg-white">
            {project.languages.map((l) => (
              <Button
                key={l.id}
                asChild
                variant="ghost"
                size="sm"
                className={`h-7 px-2.5 text-xs font-medium transition-colors ${
                  activeLang === l.langCode
                    ? "bg-brand-600 text-white hover:bg-brand-600 hover:text-white"
                    : "text-gray-600 hover:bg-gray-100"
                }`}
              >
                <Link
                  href={buildProjectQueryHref({ lang: l.langCode, q }) + (status === "failed" ? "&status=failed" : "")}
                  aria-current={activeLang === l.langCode ? "page" : undefined}
                >
                  {l.langCode.toUpperCase()}
                </Link>
              </Button>
            ))}
          </div>
        </div>
      </div>

      <p className="mb-4 text-sm text-gray-600">{locale === "de" ? "Nur neue Aktionen erfassen ein Ergebnis. Ältere Aufrufe belegen weder einen HTTP-Status noch die Herkunft einer Synchronisierung." : "Only new actions record an operation result. Older visits do not prove HTTP status or synchronization origin."}</p>

      {/* Search */}
      <div className="flex items-center gap-3 mb-4">
        <form className="flex-1 max-w-xs relative" action="" method="get">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
          <Input
            name="q"
            defaultValue={q}
            placeholder={uiText(locale, "Search URL...", "URL suchen...")}
            className="pl-9 h-9"
          />
          <input type="hidden" name="lang" value={activeLang} />
          {status === "failed" && <input type="hidden" name="status" value="failed" />}
        </form>
        <span className="text-sm text-gray-500">
          {formatNumber(total, locale)} {uiText(locale, "results", "Ergebnisse")}
        </span>
        <div className="ml-auto flex items-center gap-2 text-sm text-gray-500">
          <Link href={buildProjectQueryHref({ lang: activeLang, q }) + (status === "failed" ? "" : "&status=failed")} className="underline">{status === "failed" ? (locale === "de" ? "Alle URLs" : "All URLs") : (locale === "de" ? "Fehlerbericht" : "Error report")}</Link>
          <span>{uiText(locale, "Sorted by: most requests", "Sortiert nach: Meiste Anfragen")}</span>
        </div>
      </div>

      <UrlOperations projectId={projektId} locale={locale} wordpressSyncUrl={wordpressSyncUrl} records={urlRecords.map((record) => ({ ...record, targetUrl: new URL(record.urlPath, getProjectUrl(project.domainMappings.find((mapping) => mapping.langCode === record.langTo)?.host ?? project.domain)).toString(), lastSeenAt: record.lastSeenAt.toISOString(), lastOperationAt: record.lastOperationAt?.toISOString() ?? null, createdAt: record.createdAt.toISOString() }))} />

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
                  }) + (status === "failed" ? "&status=failed" : "")}
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
                  }) + (status === "failed" ? "&status=failed" : "")}
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
