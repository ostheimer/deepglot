import { db } from "@/lib/db";
import { notFound } from "next/navigation";
import { TranslationRequestsChart } from "@/components/statistiken/translation-requests-chart";
import { subDays, format, eachDayOfInterval } from "date-fns";
import { formatNumber } from "@/lib/locale-formatting";
import { getRequestLocale } from "@/lib/request-locale";

interface PageProps {
  params: Promise<{ projektId: string }>;
  searchParams: Promise<{ zeitraum?: string; ansicht?: string }>;
}

type Granularity = "day" | "week" | "month";

export default async function StatistikenAnfragenPage({ params, searchParams }: PageProps) {
  const { projektId } = await params;
  const { zeitraum = "30", ansicht = "day" } = await searchParams;
  const locale = await getRequestLocale();

  const project = await db.project.findUnique({
    where: { id: projektId },
    include: { languages: true },
  });
  if (!project) notFound();

  const days = parseInt(zeitraum, 10) || 30;
  const granularity = (ansicht as Granularity) || "day";

  const since = subDays(new Date(), days);

  // Build synthetic daily data from UsageRecords
  // (In production this would be from a dedicated request-log table)
  const usageRecords = await db.usageRecord.findMany({
    where: {
      projectId: projektId,
      createdAt: { gte: since },
    },
    orderBy: { createdAt: "asc" },
  });

  // Group by date
  const countByDate: Record<string, number> = {};
  for (const record of usageRecords) {
    const dateKey = format(record.createdAt, "yyyy-MM-dd");
    countByDate[dateKey] = (countByDate[dateKey] ?? 0) + record.words;
  }

  // Fill in all days in range (0 for missing days)
  const allDays = eachDayOfInterval({ start: since, end: new Date() });
  const chartData = allDays.map((date) => {
    const key = format(date, "yyyy-MM-dd");
    return {
      date: key,
      requests: countByDate[key] ?? 0,
      langPair: project.languages.length > 0
        ? `${project.originalLang.toUpperCase()} → ${project.languages[0].langCode.toUpperCase()}`
        : locale === "de"
          ? "Keine Sprache"
          : "No language",
    };
  });

  const totalRequests = Object.values(countByDate).reduce((a, b) => a + b, 0);

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

        {/* Time range selector */}
        <form method="get">
          <input type="hidden" name="ansicht" value={ansicht} />
          <select
            name="zeitraum"
            defaultValue={zeitraum}
            onChange={(event) => event.currentTarget.form?.submit()}
            className="text-sm border border-gray-200 rounded-lg px-3 py-1.5 bg-white text-gray-700 cursor-pointer focus:outline-none focus:ring-2 focus:ring-indigo-500"
          >
            {zeitraumOptions.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </form>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-[1fr_280px] gap-6">
        {/* Main chart area */}
        <div className="bg-white border border-gray-200 rounded-xl p-6">
          {/* Total + granularity toggle */}
          <div className="flex items-start justify-between mb-6">
            <div>
              <p className="text-3xl font-bold text-gray-900">
                <span className="text-indigo-600">{formatNumber(totalRequests, locale)}</span>
              </p>
              <p className="text-sm text-gray-500 mt-1">
                {locale === "de"
                  ? "Übersetzungsanfragen für den gewählten Zeitraum"
                  : "Translation requests for the selected period"}
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
                    href={`?zeitraum=${zeitraum}&ansicht=${g}`}
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
        </div>

        {/* Right sidebar: Top URLs */}
        <div className="bg-white border border-gray-200 rounded-xl p-5">
          <h3 className="text-sm font-semibold text-gray-900 mb-4">
            {locale === "de" ? "Anfragen nach URL" : "Requests by URL"}
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
  );
}
