import type { Metadata } from "next";

import { MarketingHome } from "@/components/marketing/marketing-home";
import { getPageLocale, type LocaleSearchParams } from "@/lib/request-locale";

type HomePageProps = {
  searchParams: LocaleSearchParams;
};

export async function generateMetadata({
  searchParams,
}: HomePageProps): Promise<Metadata> {
  const locale = await getPageLocale(searchParams);

  return locale === "de"
    ? {
        title: "WordPress Übersetzung ohne Cloud-Lock-in",
        description:
          "Übersetze deine WordPress-Site mit DeepL und KI, behalte die Kontrolle über deine Daten und veröffentliche mehrsprachige Seiten unter /de.",
        alternates: {
          canonical: "/de",
          languages: {
            en: "/",
            de: "/de",
            "x-default": "/",
          },
        },
        openGraph: {
          locale: "de_DE",
          url: "/de",
        },
      }
    : {
        title: "AI-powered WordPress translation without lock-in",
        description:
          "Translate your WordPress site with DeepL and AI, keep your own data, and launch multilingual pages without cloud lock-in.",
        alternates: {
          canonical: "/",
          languages: {
            en: "/",
            de: "/de",
            "x-default": "/",
          },
        },
        openGraph: {
          locale: "en_US",
          url: "/",
        },
      };
}

export default async function HomePage({ searchParams }: HomePageProps) {
  const locale = await getPageLocale(searchParams);
  return <MarketingHome locale={locale} />;
}
