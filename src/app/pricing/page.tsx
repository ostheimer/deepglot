import type { Metadata } from "next";

import { PricingPage } from "@/components/marketing/pricing-page";
import { buildMarketingMetadata } from "@/lib/marketing-metadata";
import { getPageLocale, type LocaleSearchParams } from "@/lib/request-locale";
import { uiText } from "@/lib/static-copy";

type PricingRouteProps = {
  searchParams: LocaleSearchParams;
};

export async function generateMetadata({
  searchParams,
}: PricingRouteProps): Promise<Metadata> {
  const locale = await getPageLocale(searchParams);

  return buildMarketingMetadata({
    locale,
    route: "pricing",
    title: uiText(locale, "Pricing", "Preise"),
    description: uiText(
      locale,
      "Compare Deepglot plans and launch multilingual WordPress sites without lock-in.",
      "Vergleiche die Deepglot-Pläne und veröffentliche mehrsprachige WordPress-Seiten ohne Lock-in."
    ),
  });
}

export default async function PricingRoute({ searchParams }: PricingRouteProps) {
  const locale = await getPageLocale(searchParams);
  return <PricingPage locale={locale} />;
}
