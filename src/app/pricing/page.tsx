import type { Metadata } from "next";

import { PricingPage } from "@/components/marketing/pricing-page";
import { getPageLocale, type LocaleSearchParams } from "@/lib/request-locale";

type PricingRouteProps = {
  searchParams: LocaleSearchParams;
};

export async function generateMetadata({
  searchParams,
}: PricingRouteProps): Promise<Metadata> {
  const locale = await getPageLocale(searchParams);

  return locale === "de"
    ? {
        title: "Preise",
        description:
          "Vergleiche die Deepglot-Pläne und veröffentliche mehrsprachige WordPress-Seiten mit deutscher Version unter /de/pricing.",
        alternates: {
          canonical: "/de/pricing",
          languages: {
            en: "/pricing",
            de: "/de/pricing",
            "x-default": "/pricing",
          },
        },
        openGraph: {
          locale: "de_DE",
          url: "/de/pricing",
        },
      }
    : {
        title: "Pricing",
        description: "Compare Deepglot plans and launch multilingual WordPress sites without lock-in.",
        alternates: {
          canonical: "/pricing",
          languages: {
            en: "/pricing",
            de: "/de/pricing",
            "x-default": "/pricing",
          },
        },
        openGraph: {
          locale: "en_US",
          url: "/pricing",
        },
      };
}

export default async function PricingRoute({ searchParams }: PricingRouteProps) {
  const locale = await getPageLocale(searchParams);
  return <PricingPage locale={locale} />;
}
