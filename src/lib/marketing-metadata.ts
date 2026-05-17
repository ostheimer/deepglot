import type { Metadata } from "next";

import {
  getMarketingPath,
  SITE_LOCALE_METADATA,
  SITE_LOCALES,
  type SiteLocale,
} from "@/lib/site-locale";

type MarketingRoute = Parameters<typeof getMarketingPath>[1];

export function buildMarketingMetadata({
  locale,
  route,
  title,
  description,
}: {
  locale: SiteLocale;
  route: MarketingRoute;
  title: string;
  description: string;
}): Metadata {
  const canonical = getMarketingPath(locale, route);
  const languages = Object.fromEntries(
    SITE_LOCALES.map((siteLocale) => [
      siteLocale,
      getMarketingPath(siteLocale, route),
    ])
  );

  return {
    title,
    description,
    alternates: {
      canonical,
      languages: {
        ...languages,
        "x-default": getMarketingPath("en", route),
      },
    },
    openGraph: {
      locale: SITE_LOCALE_METADATA[locale].openGraphLocale,
      url: canonical,
    },
  };
}
