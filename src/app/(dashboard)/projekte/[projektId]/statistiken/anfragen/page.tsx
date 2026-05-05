import { db } from "@/lib/db";
import { notFound } from "next/navigation";
import { TranslationRequestsChart } from "@/components/statistiken/translation-requests-chart";
import { AnalyticsRangeSelector } from "@/components/statistiken/analytics-range-selector";
import {
  buildAnalyticsHref,
  normalizeAnalyticsParams,
} from "@/lib/dashboard-query";
import {
  eachDayOfInterval,
  format,
  startOfMonth,
  startOfWeek,
  subDays,
} from "date-fns";
import { formatNumber } from "@/lib/locale-formatting";
import { requireProjectAreaAccess } from "@/lib/project-page-access";
import { getRequestLocale } from "@/lib/request-locale";

interface PageProps {
  params: Promise<{ projektId: string }>;
  searchParams: Promise<{ zeitraum?: string; ansicht?: string }>;
}

export default async function StatistikenAnfragenPage({ params, searchParams }: PageProps) {
  const { projektId } = await params;
  const rawSearchParams = await searchParams;
  const locale = await getRequestLocale();
  await requireProjectAreaAccess(projektId, "analytics");
  const { granularity, range: zeitraum } = normalizeAnalyticsParams(rawSearchParams);

  const project = await db.project.findUnique({
    where: { id: projektId },
    include: { languages: true },
  });
  if (!project) notFound();

  const days = parseInt(zeitraum, 10) || 30;
  const since = subDays(new Date(), days);
  const batchLogs = await db.translationBatchLog.findMany({
    where: {
      projectId: projektId,
      createdAt: { gte: since },
    },
    orderBy: { createdAt: "asc" },
  });

  const getBucketDate = (date: Date) => {
    if (granularity === "week") {
      return startOfWeek(date, { weekStartsOn: 1 });
    }

    if (granularity === "month") {
      return startOfMonth(date);
    }

    return date;
  };

  const sumByBucket = new Map<string, number>();

  for (const log of batchLogs) {
    const bucket = format(getBucketDate(log.createdAt), "yyyy-MM-dd");
    sumByBucket.set(bucket, (sumByBucket.get(bucket) ?? 0) + log.totalWords);
  }

  const allDays = eachDayOfInterval({ start: since, end: new Date() });
  const seen = new Set<string>();
  const chartData = allDays
    .map((date) => format(getBucketDate(date), "yyyy-MM-dd"))
    .filter((key) => {
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .map((key) => ({
      date: key,
      requests: sumByBucket.get(key) ?? 0,
      langPair: locale === "de" ? "Wörter" : "Words",
    }));

  const totalWords = batchLogs.reduce((sum, log) => sum + log.totalWords, 0);
  const totalRequests = batchLogs.length;
  const providerMix = batchLogs.reduce(
    (acc, log) => {
      acc.cached += log.cachedWords;
      acc.manual += log.manualWords;
      acc.glossary += log.glossaryWords;
      acc.provider += log.translatedWords;
      return acc;
    },
    { cached: 0, manual: 0, glossary: 0, provider: 0 }
  );
  const pairBreakdown = Array.from(
    batchLogs.reduce((acc, log) => {
      const key = `${log.langFrom.toUpperCase()} → ${log.langTo.toUpperCase()}`;
      acc.set(key, (acc.get(key) ?? 0) + log.totalWords);
      return acc;
    }, new Map<string, number>())
  ).sort((a, b) => b[1] - a[1]);
  const manualEditVolume = batchLogs
    .filter((log) => log.provider === "manual")
    .reduce((sum, log) => sum + log.manualWords, 0);
  const importActivity = batchLogs
    .filter((log) => log.provider === "import")
    .reduce((sum, log) => sum + log.totalWords, 0);

  // Top URLs by request count
  const topUrls = await db.translatedUrl.findMany({
    where: { projectId: projektId },
    orderBy: { requestCount: "desc" },
    take: 10,
  });

  const zeitraumOptions = [
    { value: "7", label: locale === "de" ? "Letzte 7 Tage" : "Last 7 days" },
    { value: "30", label: locale === "de" ? "Letzte 30 Tage" : "Last 30 days" },
    { value: "90", label: locale === "de" ? "Letzte 90 Tage" : "Last 90 days" },
  ];

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h2 className="text-xl font-bold text-gray-900">
          {locale === "de" ? "Übersetzungsanfragen" : "Translation requests"}
        </h2>

        <AnalyticsRangeSelector
          ansicht={granularity}
          zeitraum={zeitraum}
          options={zeitraumOptions}
        />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-[1fr_280px] gap-6">
        {/* Main chart area */}
        <div className="bg-white border border-gray-200 rounded-xl p-6">
          {/* Total + granularity toggle */}
          <div className="flex items-start justify-between mb-6">
            <div>
              <p className="text-3xl font-bold text-gray-900">
                <span className="text-indigo-600">{formatNumber(totalWords, locale)}</span>
              </p>
              <p className="text-sm text-gray-500 mt-1">
                {locale === "de"
                  ? "Übersetztes Volumen für den gewählten Zeitraum"
                  : "Translated volume for the selected period"}
              </p>
            </div>

            {/* DAY / WEEK / MONTH toggle */}
            <div className="flex gap-0.5 border border-gray-200 rounded-lg p-0.5 bg-gray-50">
              {(["day", "week", "month"] as const).map((g) => {
                const labels = locale === "de"
                  ? { day: "TAG", week: "WOCHE", month: "MONAT" }
                  : { day: "DAY", week: "WEEK", month: "MONTH" };
                const isActive = granularity === g;
                return (
                  <a
                    key={g}
                    href={buildAnalyticsHref({
                      granularity: g,
                      range: zeitraum,
                    })}
                    className={`px-3 py-1.5 rounded text-xs font-semibold transition-colors ${
                      isActive
                        ? "bg-indigo-600 text-white"
                        : "text-gray-500 hover:bg-white hover:text-gray-700"
                    }`}
                  >
                    {labels[g]}
                  </a>
                );
              })}
            </div>
          </div>

          <TranslationRequestsChart data={chartData} granularity={granularity} />

          <div className="mt-6 grid gap-4 md:grid-cols-2 xl:grid-cols-4">
            {[
              {
                label: locale === "de" ? "Batches" : "Batches",
                value: totalRequests,
              },
              {
                label: locale === "de" ? "Manuelle Bearbeitungen" : "Manual edits",
                value: manualEditVolume,
              },
              {
                label: locale === "de" ? "Importiertes Volumen" : "Imported volume",
                value: importActivity,
              },
              {
                label: locale === "de" ? "Provider-Wörter" : "Provider words",
                value: providerMix.provider,
              },
            ].map((item) => (
              <div
                key={item.label}
                className="rounded-xl border border-gray-100 bg-gray-50 px-4 py-3"
              >
                <p className="text-xs font-semibold uppercase tracking-wider text-gray-500">
                  {item.label}
                </p>
                <p className="mt-2 text-2xl font-bold text-gray-900">
                  {formatNumber(item.value, locale)}
                </p>
              </div>
            ))}
          </div>
        </div>

        {/* Right sidebar */}
        <div className="space-y-6">
          <div className="bg-white border border-gray-200 rounded-xl p-5">
            <h3 className="text-sm font-semibold text-gray-900 mb-4">
              {locale === "de" ? "Mix" : "Mix"}
            </h3>
            <div className="space-y-3">
              {[
                {
                  label: locale === "de" ? "Cache" : "Cache",
                  value: providerMix.cached,
                },
                {
                  label: locale === "de" ? "Manuell" : "Manual",
                  value: providerMix.manual,
                },
                {
                  label: locale === "de" ? "Glossar" : "Glossary",
                  value: providerMix.glossary,
                },
                {
                  label: locale === "de" ? "Provider" : "Provider",
                  value: providerMix.provider,
                },
              ].map((item) => (
                <div key={item.label}>
                  <div className="mb-1 flex items-center justify-between text-sm">
                    <span className="text-gray-500">{item.label}</span>
                    <span className="font-semibold text-gray-900">
                      {formatNumber(item.value, locale)}
                    </span>
                  </div>
                  <div className="h-2 rounded-full bg-gray-100">
                    <div
                      className="h-2 rounded-full bg-indigo-600"
                      style={{
                        width: `${
                          totalWords > 0 ? (item.value / totalWords) * 100 : 0
                        }%`,
                      }}
                    />
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div className="bg-white border border-gray-200 rounded-xl p-5">
            <h3 className="text-sm font-semibold text-gray-900 mb-4">
              {locale === "de" ? "Sprachpaare" : "Language pairs"}
            </h3>
            <div className="space-y-2">
              {pairBreakdown.length === 0 ? (
                <p className="text-sm text-gray-400">
                  {locale === "de" ? "Noch keine Daten." : "No data yet."}
                </p>
              ) : (
                pairBreakdown.slice(0, 6).map(([pair, value]) => (
                  <div key={pair} className="flex items-center justify-between text-sm">
                    <span className="text-gray-600">{pair}</span>
                    <span className="font-semibold text-gray-900">
                      {formatNumber(value, locale)}
                    </span>
                  </div>
                ))
              )}
            </div>
          </div>

          <div className="bg-white border border-gray-200 rounded-xl p-5">
            <h3 className="text-sm font-semibold text-gray-900 mb-4">
              {locale === "de" ? "Top-URLs" : "Top URLs"}
            </h3>

            {topUrls.length === 0 ? (
              <p className="text-sm text-gray-400 text-center py-8">
                {locale === "de" ? "Noch keine Anfragen registriert." : "No requests recorded yet."}
              </p>
            ) : (
              <div className="space-y-1">
                <div className="grid grid-cols-[1fr_auto] gap-2 pb-2 border-b border-gray-100">
                  <span className="text-xs font-semibold text-gray-400 uppercase tracking-wider">URL</span>
                  <span className="text-xs font-semibold text-gray-400 uppercase tracking-wider text-right">
                    {locale === "de" ? "ANFRAGEN" : "REQUESTS"}
                  </span>
                </div>
                {topUrls.map((url) => (
                  <div
                    key={url.id}
                    className="grid grid-cols-[1fr_auto] gap-2 py-2 border-b border-gray-50 last:border-0 hover:bg-gray-50 -mx-2 px-2 rounded transition-colors"
                  >
                    <span
                      className="text-xs text-gray-700 truncate"
                      title={`https://${project.domain}${url.urlPath}`}
                    >
                      https://{project.domain}{url.urlPath}
                    </span>
                    <span className="text-xs font-semibold text-gray-900 text-right whitespace-nowrap">
                      {formatNumber(url.requestCount, locale)}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
