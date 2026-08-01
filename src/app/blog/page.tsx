import type { Metadata } from "next";
import { permanentRedirect } from "next/navigation";

import { BlogArchive } from "@/components/marketing/blog-archive";
import {
  BILINGUAL_PUBLIC_LOCALES,
  getBilingualPublicLocale,
  isBilingualPublicLocale,
} from "@/lib/bilingual-public-content";
import { buildMarketingMetadata } from "@/lib/marketing-metadata";
import { getPageLocale, type LocaleSearchParams } from "@/lib/request-locale";
import { getMarketingPath } from "@/lib/site-locale";
import { uiText } from "@/lib/static-copy";

type BlogPageProps = { searchParams: LocaleSearchParams };

export async function generateMetadata({ searchParams }: BlogPageProps): Promise<Metadata> {
  const locale = await getPageLocale(searchParams);
  const contentLocale = getBilingualPublicLocale(locale);

  return buildMarketingMetadata({
    locale: contentLocale,
    contentLocale,
    alternateLocales: BILINGUAL_PUBLIC_LOCALES,
    route: "blog",
    title: uiText(contentLocale, "Blog", "Blog"),
    description: uiText(
      contentLocale,
      "Product decisions, WordPress engineering, and lessons from building an open translation platform in Austria.",
      "Produktentscheidungen, WordPress Engineering und Erfahrungen aus dem Aufbau einer offenen Übersetzungsplattform in Österreich."
    ),
  });
}

export default async function BlogPage({ searchParams }: BlogPageProps) {
  const locale = await getPageLocale(searchParams);

  if (!isBilingualPublicLocale(locale)) {
    permanentRedirect(getMarketingPath("en", "blog"));
  }

  return <BlogArchive locale={locale} />;
}
