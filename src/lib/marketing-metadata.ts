import type { Metadata } from "next";

import {
  getMarketingPath,
  SITE_LOCALE_METADATA,
  SITE_LOCALES,
  type SiteLocale,
} from "@/lib/site-locale";

type MarketingRoute = Parameters<typeof getMarketingPath>[1];
type SocialMetadataOptions = {
  locale: SiteLocale;
  title: string;
  description: string;
  canonical: string;
  languages: Record<string, string>;
  article?: {
    publishedTime: string;
  };
};

const SOCIAL_IMAGE = {
  url: "/opengraph-image.png",
  width: 1200,
  height: 630,
  alt: "Deepglot — WordPress translation built in Austria",
} as const;

export function buildPageMetadata({
  locale,
  title,
  description,
  canonical,
  languages,
  article,
}: SocialMetadataOptions): Metadata {
  const openGraphBase = {
    locale: SITE_LOCALE_METADATA[locale].openGraphLocale,
    url: canonical,
    siteName: "Deepglot",
    title,
    description,
    images: [SOCIAL_IMAGE],
  };

  return {
    title,
    description,
    alternates: {
      canonical,
      languages,
    },
    openGraph: article
      ? {
          ...openGraphBase,
          type: "article",
          publishedTime: article.publishedTime,
        }
      : {
          ...openGraphBase,
          type: "website",
        },
    twitter: {
      card: "summary_large_image",
      title,
      description,
      images: [SOCIAL_IMAGE],
    },
  };
}

export function buildMarketingMetadata({
  locale,
  route,
  title,
  description,
  contentLocale = locale,
  alternateLocales = SITE_LOCALES,
}: {
  locale: SiteLocale;
  route: MarketingRoute;
  title: string;
  description: string;
  contentLocale?: SiteLocale;
  alternateLocales?: readonly SiteLocale[];
}): Metadata {
  const canonical = getMarketingPath(contentLocale, route);
  const languages = Object.fromEntries(
    alternateLocales.map((siteLocale) => [
      siteLocale,
      getMarketingPath(siteLocale, route),
    ])
  );

  return buildPageMetadata({
    locale: contentLocale,
    title,
    description,
    canonical,
    languages: {
      ...languages,
      "x-default": getMarketingPath("en", route),
    },
  });
}
