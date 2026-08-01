import type { Metadata } from "next";
import { permanentRedirect } from "next/navigation";

import { DeveloperDocs } from "@/components/marketing/developer-docs";
import {
  BILINGUAL_PUBLIC_LOCALES,
  getBilingualPublicLocale,
  isBilingualPublicLocale,
} from "@/lib/bilingual-public-content";
import { buildMarketingMetadata } from "@/lib/marketing-metadata";
import { getPageLocale, type LocaleSearchParams } from "@/lib/request-locale";
import { getMarketingPath } from "@/lib/site-locale";
import { uiText } from "@/lib/static-copy";

type DocsPageProps = {
  searchParams: LocaleSearchParams;
};

export async function generateMetadata({
  searchParams,
}: DocsPageProps): Promise<Metadata> {
  const locale = await getPageLocale(searchParams);
  const contentLocale = getBilingualPublicLocale(locale);

  return buildMarketingMetadata({
    locale: contentLocale,
    contentLocale,
    alternateLocales: BILINGUAL_PUBLIC_LOCALES,
    route: "docs",
    title: uiText(contentLocale, "Documentation", "Dokumentation"),
    description: uiText(
      contentLocale,
      "Source-backed Deepglot API and WordPress integration reference.",
      "Source-basierte Deepglot-API- und WordPress-Integrationsreferenz."
    ),
  });
}

export default async function DocsPage({ searchParams }: DocsPageProps) {
  const locale = await getPageLocale(searchParams);

  if (!isBilingualPublicLocale(locale)) {
    permanentRedirect(getMarketingPath("en", "docs"));
  }

  return <DeveloperDocs locale={locale} />;
}
