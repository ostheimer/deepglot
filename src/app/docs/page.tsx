import type { Metadata } from "next";

import { DeveloperDocs } from "@/components/marketing/developer-docs";
import { buildMarketingMetadata } from "@/lib/marketing-metadata";
import { getPageLocale, type LocaleSearchParams } from "@/lib/request-locale";
import { uiText } from "@/lib/static-copy";

type DocsPageProps = {
  searchParams: LocaleSearchParams;
};

export async function generateMetadata({
  searchParams,
}: DocsPageProps): Promise<Metadata> {
  const locale = await getPageLocale(searchParams);

  return buildMarketingMetadata({
    locale,
    route: "docs",
    title: uiText(locale, "Documentation", "Dokumentation"),
    description: uiText(
      locale,
      "Source-backed Deepglot API and WordPress integration reference.",
      "Source-basierte Deepglot-API- und WordPress-Integrationsreferenz."
    ),
  });
}

export default async function DocsPage({ searchParams }: DocsPageProps) {
  const locale = await getPageLocale(searchParams);

  return <DeveloperDocs locale={locale} />;
}
