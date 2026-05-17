import type { Metadata } from "next";

import { MarketingHome } from "@/components/marketing/marketing-home";
import { getPageLocale, type LocaleSearchParams } from "@/lib/request-locale";
import { getMarketingPath, SITE_LOCALE_METADATA, SITE_LOCALES } from "@/lib/site-locale";
import { uiText } from "@/lib/static-copy";

type HomePageProps = {
  searchParams: LocaleSearchParams;
};

export async function generateMetadata({
  searchParams,
}: HomePageProps): Promise<Metadata> {
  const locale = await getPageLocale(searchParams);
  const canonical = getMarketingPath(locale, "home");
  const languages = Object.fromEntries(
    SITE_LOCALES.map((siteLocale) => [siteLocale, getMarketingPath(siteLocale, "home")])
  );

  return {
    title: uiText(
      locale,
      "AI-powered WordPress translation without lock-in",
      "WordPress Übersetzung ohne Cloud-Lock-in"
    ),
    description: uiText(
      locale,
      "Translate your WordPress site with modern AI providers, keep your own data, and launch multilingual pages without cloud lock-in.",
      "Übersetze deine WordPress-Site mit modernen KI-Providern, behalte die Kontrolle über deine Daten und veröffentliche mehrsprachige Seiten ohne Cloud-Lock-in."
    ),
    alternates: {
      canonical,
      languages: {
        ...languages,
        "x-default": getMarketingPath("en", "home"),
      },
    },
    openGraph: {
      locale: SITE_LOCALE_METADATA[locale].openGraphLocale,
      url: canonical,
    },
  };
}

export default async function HomePage({ searchParams }: HomePageProps) {
  const locale = await getPageLocale(searchParams);
  return <MarketingHome locale={locale} />;
}
