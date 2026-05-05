export type AnalyticsGranularity = "day" | "week" | "month";

const ANALYTICS_GRANULARITIES = new Set<AnalyticsGranularity>([
  "day",
  "week",
  "month",
]);
const ANALYTICS_RANGES = new Set(["7", "30", "90"]);

export function normalizeProjectLang(
  requestedLang: string | undefined,
  languageCodes: string[],
  fallback = "en"
) {
  const normalizedCodes = languageCodes.map((code) => code.toLowerCase());
  const requested = requestedLang?.toLowerCase();

  if (requested && normalizedCodes.includes(requested)) {
    return requested;
  }

  return normalizedCodes[0] ?? fallback;
}

export function buildProjectQueryHref({
  lang,
  page,
  q,
}: {
  lang: string;
  page?: number;
  q?: string;
}) {
  const params = new URLSearchParams();
  params.set("lang", lang);

  if (page && page > 1) {
    params.set("seite", String(page));
  }

  if (q) {
    params.set("q", q);
  }

  return `?${params.toString()}`;
}

export function normalizeAnalyticsParams({
  ansicht,
  zeitraum,
}: {
  ansicht?: string;
  zeitraum?: string;
}) {
  const granularity: AnalyticsGranularity = ANALYTICS_GRANULARITIES.has(
    ansicht as AnalyticsGranularity
  )
    ? (ansicht as AnalyticsGranularity)
    : "day";
  const range = zeitraum && ANALYTICS_RANGES.has(zeitraum) ? zeitraum : "30";

  return { granularity, range };
}

export function buildAnalyticsHref({
  granularity,
  range,
}: {
  granularity: AnalyticsGranularity;
  range: string;
}) {
  const params = new URLSearchParams();
  params.set("zeitraum", range);
  params.set("ansicht", granularity);

  return `?${params.toString()}`;
}
