import { db } from "@/lib/db";
import { notFound } from "next/navigation";
import { getRequestLocale } from "@/lib/request-locale";
import { EnablePageViewsButton } from "@/components/projekte/enable-page-views-button";

interface PageProps {
  params: Promise<{ projektId: string }>;
}

export default async function SeitenaufrufeStatistikPage({ params }: PageProps) {
  const { projektId } = await params;
  const locale = await getRequestLocale();

  const project = await db.project.findUnique({
    where: { id: projektId },
    include: {
      settings: true,
      translatedUrls: {
        orderBy: [{ requestCount: "desc" }, { lastSeenAt: "desc" }],
        take: 8,
      },
    },
  });
  if (!project) notFound();

  // Page views tracking is opt-in (requires JS snippet activation)
  const isActivated = project.settings?.pageViewsEnabled ?? false;
  const aggregate = isActivated
    ? await db.translatedUrl.aggregate({
        where: { projectId: projektId },
        _count: { _all: true },
        _sum: { requestCount: true, wordCount: true },
      })
    : null;
  const totalTrackedUrls = aggregate?._count._all ?? 0;
  const totalRequests = aggregate?._sum.requestCount ?? 0;
  const totalWords = aggregate?._sum.wordCount ?? 0;
  const latestSeenAt = project.translatedUrls.reduce<Date | null>(
    (latest, entry) =>
      !latest || entry.lastSeenAt > latest ? entry.lastSeenAt : latest,
    null
  );

  return (
    <div>
      <h2 className="text-xl font-bold text-gray-900 mb-6">
        {locale === "de" ? "Seitenaufrufe" : "Page views"}
      </h2>

      {!isActivated ? (
        <div className="bg-white border border-gray-200 rounded-xl py-24 flex flex-col items-center justify-center text-center px-8">
          {/* Reference-style icon */}
          <div className="relative mb-6">
            <div className="h-20 w-20 rounded-2xl bg-gray-100 flex items-center justify-center">
              <svg
                className="h-10 w-10 text-gray-400"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={1.5}
                  d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z"
                />
              </svg>
            </div>
            <div className="absolute -top-1 -right-1 h-6 w-6 rounded-full bg-gray-100 border-2 border-white flex items-center justify-center">
              <svg className="h-3 w-3 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6v6m0 0v6m0-6h6m-6 0H6" />
              </svg>
            </div>
          </div>

          <h3 className="text-lg font-semibold text-gray-900 mb-2">
            {locale === "de" ? "Seitenaufrufe noch nicht aktiviert." : "Page views are not enabled yet."}
          </h3>
          <p className="text-gray-500 text-sm mb-8 max-w-sm">
            {locale === "de"
              ? "Aktiviere die Seitenaufruf-Statistiken um erweiterte Daten darüber zu erhalten, welche übersetzten Seiten am häufigsten besucht werden."
              : "Enable page-view analytics to see which translated pages are visited most often."}
          </p>

          <EnablePageViewsButton projectId={projektId} />

          <div className="mt-8 border border-gray-100 rounded-xl p-5 text-left max-w-sm w-full">
            <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-3">
              {locale === "de" ? "Was du mit Seitenaufrufen erhältst:" : "What you get with page views:"}
            </p>
            <ul className="space-y-2 text-sm text-gray-600">
              {[
                locale === "de" ? "Anzahl der Aufrufe pro übersetzter Seite" : "View count per translated page",
                locale === "de" ? "Vergleich Original vs. übersetzte Versionen" : "Compare original vs translated versions",
                locale === "de" ? "Zeitlicher Verlauf nach Tag/Woche/Monat" : "Trend over day/week/month",
                locale === "de" ? "Meistbesuchte übersetzte URLs" : "Most visited translated URLs",
              ].map((f) => (
                <li key={f} className="flex items-center gap-2">
                  <span className="h-1.5 w-1.5 rounded-full bg-indigo-400 flex-shrink-0" />
                  {f}
                </li>
              ))}
            </ul>
          </div>
        </div>
      ) : (
        <div className="space-y-6">
          <div className="grid gap-4 md:grid-cols-3">
            <div className="rounded-xl border border-gray-200 bg-white p-5">
              <p className="text-xs font-semibold uppercase tracking-wider text-gray-500">
                {locale === "de" ? "Erfasste URLs" : "Tracked URLs"}
              </p>
              <p className="mt-2 text-2xl font-bold text-gray-900">
                {totalTrackedUrls}
              </p>
            </div>
            <div className="rounded-xl border border-gray-200 bg-white p-5">
              <p className="text-xs font-semibold uppercase tracking-wider text-gray-500">
                {locale === "de" ? "Gesamte Aufrufe" : "Total views"}
              </p>
              <p className="mt-2 text-2xl font-bold text-gray-900">
                {totalRequests}
              </p>
            </div>
            <div className="rounded-xl border border-gray-200 bg-white p-5">
              <p className="text-xs font-semibold uppercase tracking-wider text-gray-500">
                {locale === "de" ? "Zuletzt gesehen" : "Last seen"}
              </p>
              <p className="mt-2 text-sm font-semibold text-gray-900">
                {latestSeenAt
                  ? new Intl.DateTimeFormat(locale === "de" ? "de-DE" : "en-US", {
                      dateStyle: "medium",
                      timeStyle: "short",
                    }).format(latestSeenAt)
                  : locale === "de"
                    ? "Noch keine Daten"
                    : "No data yet"}
              </p>
            </div>
          </div>

          <div className="rounded-xl border border-gray-200 bg-white overflow-hidden">
            <div className="flex items-center justify-between border-b border-gray-100 px-5 py-4">
              <div>
                <h3 className="text-sm font-semibold text-gray-900">
                  {locale === "de"
                    ? "Top uebersetzte Seiten"
                    : "Top translated pages"}
                </h3>
                <p className="mt-1 text-xs text-gray-500">
                  {locale === "de"
                    ? `Aktuell ${totalWords} Woerter ueber ${totalTrackedUrls} URLs erfasst`
                    : `Currently tracking ${totalWords} words across ${totalTrackedUrls} URLs`}
                </p>
              </div>
            </div>

            {project.translatedUrls.length > 0 ? (
              <div className="divide-y divide-gray-100">
                {project.translatedUrls.map((entry) => (
                  <div
                    key={entry.id}
                    className="grid grid-cols-[1fr_auto_auto] gap-4 px-5 py-4 items-center"
                  >
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium text-gray-900">
                        {entry.urlPath}
                      </p>
                      <p className="mt-1 text-xs text-gray-500">
                        {locale === "de" ? "Sprache" : "Language"}:{" "}
                        <span className="font-medium uppercase text-gray-700">
                          {entry.langTo}
                        </span>
                      </p>
                    </div>
                    <div className="text-right">
                      <p className="text-sm font-semibold text-gray-900">
                        {entry.requestCount}
                      </p>
                      <p className="text-xs text-gray-500">
                        {locale === "de" ? "Aufrufe" : "Views"}
                      </p>
                    </div>
                    <div className="text-right">
                      <p className="text-sm font-semibold text-gray-900">
                        {entry.wordCount}
                      </p>
                      <p className="text-xs text-gray-500">
                        {locale === "de" ? "Woerter" : "Words"}
                      </p>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="px-5 py-12 text-center">
                <p className="text-sm font-medium text-gray-600">
                  {locale === "de"
                    ? "Seitenaufrufe sind aktiviert, aber es wurden noch keine Daten gesammelt."
                    : "Page views are enabled, but no data has been collected yet."}
                </p>
                <p className="mt-2 text-xs text-gray-400">
                  {locale === "de"
                    ? "Sobald dein Plugin uebersetzte URLs meldet, erscheinen sie hier."
                    : "Translated URLs will appear here as soon as your plugin starts reporting them."}
                </p>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
