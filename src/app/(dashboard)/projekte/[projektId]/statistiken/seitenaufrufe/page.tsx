import { subDays } from "date-fns";
import { notFound } from "next/navigation";

import { EnablePageViewsButton } from "@/components/projekte/enable-page-views-button";
import { AnalyticsRangeSelector } from "@/components/statistiken/analytics-range-selector";
import { normalizeAnalyticsParams } from "@/lib/dashboard-query";
import { db } from "@/lib/db";
import { formatNumber } from "@/lib/locale-formatting";
import { pageViewText } from "@/lib/page-view-copy";
import { requireProjectAreaAccess } from "@/lib/project-page-access";
import { getRequestLocale } from "@/lib/request-locale";
import { uiText } from "@/lib/static-copy";

interface PageProps {
  params: Promise<{ projektId: string }>;
  searchParams: Promise<{ zeitraum?: string; ansicht?: string }>;
}

export default async function SeitenaufrufeStatistikPage({
  params,
  searchParams,
}: PageProps) {
  const { projektId } = await params;
  const rawSearchParams = await searchParams;
  const locale = await getRequestLocale();
  await requireProjectAreaAccess(projektId, "analytics");

  const { granularity, range } = normalizeAnalyticsParams(rawSearchParams);
  const project = await db.project.findUnique({
    where: { id: projektId },
    select: {
      settings: {
        select: { pageViewsEnabled: true, pageViewsConsentGrantedAt: true },
      },
    },
  });
  if (!project) notFound();

  const isActivated =
    project.settings?.pageViewsEnabled === true &&
    project.settings.pageViewsConsentGrantedAt !== null;
  const since = subDays(new Date(), Number(range));
  const pageViewGroups = isActivated
    ? await db.pageView.groupBy({
        by: ["urlPath", "langTo"],
        where: { projectId: projektId, createdAt: { gte: since } },
        _count: { _all: true },
        _max: { createdAt: true },
        orderBy: [
          { _count: { urlPath: "desc" } },
          { urlPath: "asc" },
          { langTo: "asc" },
        ],
      })
    : [];

  const totalViews = pageViewGroups.reduce(
    (total, group) => total + group._count._all,
    0
  );
  const latestSeenAt = pageViewGroups.reduce<Date | null>((latest, group) => {
    const seenAt = group._max.createdAt;
    return seenAt && (!latest || seenAt > latest) ? seenAt : latest;
  }, null);
  const languageCounts = Array.from(
    pageViewGroups.reduce((counts, group) => {
      counts.set(group.langTo, (counts.get(group.langTo) ?? 0) + group._count._all);
      return counts;
    }, new Map<string, number>())
  ).sort((left, right) => right[1] - left[1]);

  const rangeOptions = [
    { value: "7", label: uiText(locale, "Last 7 days", "Letzte 7 Tage") },
    { value: "30", label: uiText(locale, "Last 30 days", "Letzte 30 Tage") },
    { value: "90", label: uiText(locale, "Last 90 days", "Letzte 90 Tage") },
  ];

  return (
    <div>
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-xl font-bold text-gray-900">
          {uiText(locale, "Page views", "Seitenaufrufe")}
        </h2>

        {isActivated ? (
          <AnalyticsRangeSelector
            ansicht={granularity}
            zeitraum={range}
            options={rangeOptions}
          />
        ) : null}
      </div>

      {!isActivated ? (
        <div className="rounded-xl border border-gray-200 bg-white px-8 py-20 text-center">
          <div className="mx-auto mb-6 flex h-20 w-20 items-center justify-center rounded-2xl bg-gray-100">
            <svg
              className="h-10 w-10 text-gray-400"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              aria-hidden="true"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={1.5}
                d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z"
              />
            </svg>
          </div>

          <h3 className="mb-2 text-lg font-semibold text-gray-900">
            {uiText(
              locale,
              "Page views are not enabled yet.",
              "Seitenaufrufe noch nicht aktiviert."
            )}
          </h3>
          <p className="mx-auto mb-8 max-w-lg text-sm text-gray-500">
            {uiText(
              locale,
              "Enable page-view analytics to see which translated pages are visited most often.",
              "Aktiviere die Seitenaufruf-Statistiken, um zu sehen, welche übersetzten Seiten am häufigsten besucht werden."
            )}
          </p>

          <EnablePageViewsButton projectId={projektId} />

          <div className="mx-auto mt-8 max-w-lg rounded-xl border border-gray-100 p-5 text-left">
            <p className="mb-3 text-xs font-semibold uppercase tracking-wider text-gray-500">
              {uiText(locale, "Privacy", "Datenschutz")}
            </p>
            <ul className="space-y-2 text-sm text-gray-600">
              {[
                pageViewText(locale, "consent"),
                pageViewText(locale, "fields"),
                pageViewText(locale, "excluded"),
                pageViewText(locale, "retention"),
              ].map((item) => (
                <li key={item} className="flex items-start gap-2">
                  <span className="mt-1.5 h-1.5 w-1.5 flex-shrink-0 rounded-full bg-brand-400" />
                  {item}
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
                {uiText(locale, "Tracked URLs", "Erfasste URLs")}
              </p>
              <p className="mt-2 text-2xl font-bold text-gray-900">
                {formatNumber(pageViewGroups.length, locale)}
              </p>
            </div>
            <div className="rounded-xl border border-gray-200 bg-white p-5">
              <p className="text-xs font-semibold uppercase tracking-wider text-gray-500">
                {uiText(locale, "Total views", "Gesamte Aufrufe")}
              </p>
              <p className="mt-2 text-2xl font-bold text-gray-900">
                {formatNumber(totalViews, locale)}
              </p>
            </div>
            <div className="rounded-xl border border-gray-200 bg-white p-5">
              <p className="text-xs font-semibold uppercase tracking-wider text-gray-500">
                {uiText(locale, "Last seen", "Zuletzt gesehen")}
              </p>
              <p className="mt-2 text-sm font-semibold text-gray-900">
                {latestSeenAt
                  ? new Intl.DateTimeFormat(locale === "de" ? "de-DE" : "en-US", {
                      dateStyle: "medium",
                      timeStyle: "short",
                    }).format(latestSeenAt)
                  : uiText(locale, "No data yet", "Noch keine Daten")}
              </p>
            </div>
          </div>

          {languageCounts.length > 0 ? (
            <div className="rounded-xl border border-gray-200 bg-white p-5">
              <h3 className="mb-3 text-sm font-semibold text-gray-900">
                {uiText(locale, "Language", "Sprache")}
              </h3>
              <div className="flex flex-wrap gap-2">
                {languageCounts.map(([language, count]) => (
                  <div
                    key={language}
                    className="rounded-full bg-gray-100 px-3 py-1.5 text-sm text-gray-700"
                  >
                    <span className="font-semibold uppercase">{language}</span>
                    {" · "}
                    {formatNumber(count, locale)}
                  </div>
                ))}
              </div>
            </div>
          ) : null}

          <div className="overflow-hidden rounded-xl border border-gray-200 bg-white">
            <div className="border-b border-gray-100 px-5 py-4">
              <h3 className="text-sm font-semibold text-gray-900">
                {uiText(locale, "Top translated pages", "Top übersetzte Seiten")}
              </h3>
              <p className="mt-1 text-xs text-gray-500">
                {uiText(locale, "View count per translated page", "Anzahl der Aufrufe pro übersetzter Seite")}
              </p>
            </div>

            {pageViewGroups.length > 0 ? (
              <div className="divide-y divide-gray-100">
                {pageViewGroups.slice(0, 8).map((entry) => (
                  <div
                    key={`${entry.langTo}:${entry.urlPath}`}
                    className="grid grid-cols-[1fr_auto] items-center gap-4 px-5 py-4"
                  >
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium text-gray-900">
                        {entry.urlPath}
                      </p>
                      <p className="mt-1 text-xs text-gray-500">
                        {uiText(locale, "Language", "Sprache")}:{" "}
                        <span className="font-medium uppercase text-gray-700">
                          {entry.langTo}
                        </span>
                      </p>
                    </div>
                    <div className="text-right">
                      <p className="text-sm font-semibold text-gray-900">
                        {formatNumber(entry._count._all, locale)}
                      </p>
                      <p className="text-xs text-gray-500">
                        {uiText(locale, "Views", "Aufrufe")}
                      </p>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="px-5 py-12 text-center">
                <p className="text-sm font-medium text-gray-600">
                  {uiText(
                    locale,
                    "Page views are enabled, but no data has been collected yet.",
                    "Seitenaufrufe sind aktiviert, aber es wurden noch keine Daten gesammelt."
                  )}
                </p>
                <p className="mt-2 text-xs text-gray-400">
                  {pageViewText(locale, "history")}
                </p>
              </div>
            )}
          </div>

          <div className="flex flex-wrap items-center justify-between gap-4 rounded-xl border border-gray-200 bg-white p-5">
            <div>
              <p className="text-sm font-semibold text-gray-900">
                {uiText(locale, "Privacy", "Datenschutz")}
              </p>
              <p className="mt-1 text-xs text-gray-500">
                {pageViewText(locale, "fields")} {pageViewText(locale, "retention")}
              </p>
            </div>
            <EnablePageViewsButton projectId={projektId} enabled />
          </div>
        </div>
      )}
    </div>
  );
}
