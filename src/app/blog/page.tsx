import type { Metadata } from "next";

import { BlogArchive } from "@/components/marketing/blog-archive";
import { buildMarketingMetadata } from "@/lib/marketing-metadata";
import { getPageLocale, type LocaleSearchParams } from "@/lib/request-locale";
import { uiText } from "@/lib/static-copy";

type BlogPageProps = { searchParams: LocaleSearchParams };

export async function generateMetadata({ searchParams }: BlogPageProps): Promise<Metadata> {
  const locale = await getPageLocale(searchParams);

  return buildMarketingMetadata({
    locale,
    route: "blog",
    title: uiText(locale, "Blog", "Blog"),
    description: uiText(
      locale,
      "Product decisions, WordPress engineering, and lessons from building an open translation platform in Austria.",
      "Produktentscheidungen, WordPress Engineering und Erfahrungen aus dem Aufbau einer offenen Übersetzungsplattform in Österreich."
    ),
  });
}

export default async function BlogPage({ searchParams }: BlogPageProps) {
  const locale = await getPageLocale(searchParams);
  return <BlogArchive locale={locale} />;
}
