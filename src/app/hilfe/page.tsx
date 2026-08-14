import type { Metadata } from "next";
import { permanentRedirect } from "next/navigation";

import { HelpPage } from "@/components/marketing/help-page";
import {
  BILINGUAL_PUBLIC_LOCALES,
  getBilingualPublicLocale,
  isBilingualPublicLocale,
} from "@/lib/bilingual-public-content";
import { buildMarketingMetadata } from "@/lib/marketing-metadata";
import { getPageLocale, type LocaleSearchParams } from "@/lib/request-locale";
import { getMarketingPath } from "@/lib/site-locale";

type HelpRouteProps = {
  searchParams: LocaleSearchParams;
};

export async function generateMetadata({
  searchParams,
}: HelpRouteProps): Promise<Metadata> {
  const locale = await getPageLocale(searchParams);
  const contentLocale = getBilingualPublicLocale(locale);

  return buildMarketingMetadata({
    locale: contentLocale,
    contentLocale,
    alternateLocales: BILINGUAL_PUBLIC_LOCALES,
    route: "help",
    title: contentLocale === "de" ? "Hilfe" : "Help",
    description:
      contentLocale === "de"
        ? "Praktische Deepglot-Hilfe zu Wochenrückblick, WordPress-Versionen und Betriebsgrenzen."
        : "Practical Deepglot help for weekly digests, WordPress releases, and operational boundaries.",
  });
}

export default async function HelpRoute({ searchParams }: HelpRouteProps) {
  const locale = await getPageLocale(searchParams);

  if (!isBilingualPublicLocale(locale)) {
    permanentRedirect(getMarketingPath("en", "help"));
  }

  return <HelpPage locale={locale} />;
}
