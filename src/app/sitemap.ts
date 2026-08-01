import type { MetadataRoute } from "next";

import { getBlogArticlePath, getBlogPosts } from "@/lib/blog";
import { CANONICAL_APP_HOST } from "@/lib/canonical-host";
import { getMarketingPath, SITE_LOCALES } from "@/lib/site-locale";

const ORIGIN = `https://${CANONICAL_APP_HOST}`;
const LAST_MODIFIED = new Date("2026-08-01T00:00:00.000Z");

export default function sitemap(): MetadataRoute.Sitemap {
  return SITE_LOCALES.flatMap((locale) => {
    const marketingEntries: MetadataRoute.Sitemap = [
      {
        url: `${ORIGIN}${getMarketingPath(locale, "home")}`,
        lastModified: LAST_MODIFIED,
        changeFrequency: "weekly",
        priority: locale === "en" ? 1 : 0.9,
      },
      {
        url: `${ORIGIN}${getMarketingPath(locale, "pricing")}`,
        lastModified: LAST_MODIFIED,
        changeFrequency: "monthly",
        priority: 0.8,
      },
      {
        url: `${ORIGIN}${getMarketingPath(locale, "docs")}`,
        lastModified: LAST_MODIFIED,
        changeFrequency: "weekly",
        priority: 0.8,
      },
      {
        url: `${ORIGIN}${getMarketingPath(locale, "blog")}`,
        lastModified: LAST_MODIFIED,
        changeFrequency: "weekly",
        priority: 0.8,
      },
      {
        url: `${ORIGIN}${getMarketingPath(locale, "privacy")}`,
        lastModified: LAST_MODIFIED,
        changeFrequency: "yearly",
        priority: 0.3,
      },
      {
        url: `${ORIGIN}${getMarketingPath(locale, "legalNotice")}`,
        lastModified: LAST_MODIFIED,
        changeFrequency: "yearly",
        priority: 0.3,
      },
      {
        url: `${ORIGIN}${getMarketingPath(locale, "terms")}`,
        lastModified: LAST_MODIFIED,
        changeFrequency: "yearly",
        priority: 0.3,
      },
    ];
    const articleEntries: MetadataRoute.Sitemap = getBlogPosts(locale).map(
      (post) => ({
        url: `${ORIGIN}${getBlogArticlePath(locale, post.slug)}`,
        lastModified: new Date(`${post.publishedAt}T00:00:00.000Z`),
        changeFrequency: "monthly" as const,
        priority: 0.7,
      })
    );

    return [...marketingEntries, ...articleEntries];
  });
}
