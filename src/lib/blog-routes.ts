import type { SiteLocale } from "@/lib/site-locale";

export const BLOG_ARTICLE_SLUGS = {
  portability: {
    en: "wordpress-translation-without-lock-in",
    de: "wordpress-uebersetzen-ohne-lock-in",
  },
  "translated-slugs": {
    en: "translated-url-slugs-for-wordpress",
    de: "uebersetzte-url-slugs-fuer-wordpress",
  },
  austria: {
    en: "built-in-austria-for-24-languages",
    de: "aus-oesterreich-fuer-24-sprachen",
  },
} as const;

export type BlogArticleId = keyof typeof BLOG_ARTICLE_SLUGS;

export function getBlogArticleSlug(id: BlogArticleId, locale: SiteLocale) {
  return locale === "de"
    ? BLOG_ARTICLE_SLUGS[id].de
    : BLOG_ARTICLE_SLUGS[id].en;
}

export function localizeBlogArticlePathname(
  pathname: string,
  targetLocale: SiteLocale
) {
  for (const [id, slugs] of Object.entries(BLOG_ARTICLE_SLUGS)) {
    const matchedSlug = [slugs.en, slugs.de].find((slug) =>
      pathname.split("/").includes(slug)
    );

    if (matchedSlug) {
      return pathname.replace(
        `/${matchedSlug}`,
        `/${getBlogArticleSlug(id as BlogArticleId, targetLocale)}`
      );
    }
  }

  return pathname;
}
