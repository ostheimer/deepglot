import type { Metadata } from "next";

import { PricingPage } from "@/components/marketing/pricing-page";
import { getPageLocale, type LocaleSearchParams } from "@/lib/request-locale";
import { getMarketingPath, SITE_LOCALE_METADATA, SITE_LOCALES } from "@/lib/site-locale";
import { uiText } from "@/lib/static-copy";

type PricingRouteProps = {
  searchParams: LocaleSearchParams;
};

export async function generateMetadata({
  searchParams,
}: PricingRouteProps): Promise<Metadata> {
  const locale = await getPageLocale(searchParams);
  const canonical = getMarketingPath(locale, "pricing");
  const languages = Object.fromEntries(
    SITE_LOCALES.map((siteLocale) => [siteLocale, getMarketingPath(siteLocale, "pricing")])
  );

  return {
    title: uiText(locale, "Pricing", "Preise"),
    description: uiText(
      locale,
      "Compare Deepglot plans and launch multilingual WordPress sites without lock-in.",
      "Vergleiche die Deepglot-Pläne und veröffentliche mehrsprachige WordPress-Seiten ohne Lock-in."
    ),
    alternates: {
      canonical,
      languages: {
        ...languages,
        "x-default": getMarketingPath("en", "pricing"),
      },
    },
    openGraph: {
      locale: SITE_LOCALE_METADATA[locale].openGraphLocale,
      url: canonical,
    },
  };
}

export default async function PricingRoute({ searchParams }: PricingRouteProps) {
  const locale = await getPageLocale(searchParams);
  return <PricingPage locale={locale} />;
}
