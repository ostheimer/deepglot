import { CANONICAL_APP_HOST } from "@/lib/canonical-host";
import { SITE_LOCALE_METADATA, type SiteLocale } from "@/lib/site-locale";

const CANONICAL_ORIGIN = `https://${CANONICAL_APP_HOST}`;

export function buildBlogArticleStructuredData({
  title,
  description,
  publishedAt,
  contentLocale,
  canonicalPath,
}: {
  title: string;
  description: string;
  publishedAt: string;
  contentLocale: SiteLocale;
  canonicalPath: string;
}) {
  const articleUrl = new URL(canonicalPath, CANONICAL_ORIGIN).toString();

  return {
    "@context": "https://schema.org",
    "@type": "Article",
    headline: title,
    description,
    datePublished: publishedAt,
    dateModified: publishedAt,
    inLanguage: SITE_LOCALE_METADATA[contentLocale].intlLocale,
    image: `${CANONICAL_ORIGIN}/opengraph-image.png`,
    mainEntityOfPage: { "@type": "WebPage", "@id": articleUrl },
    author: {
      "@type": "Organization",
      name: "Deepglot",
      url: CANONICAL_ORIGIN,
    },
    publisher: {
      "@type": "Organization",
      name: "Ostheimer OG",
      url: CANONICAL_ORIGIN,
      logo: {
        "@type": "ImageObject",
        url: `${CANONICAL_ORIGIN}/icon.png`,
        width: 512,
        height: 512,
      },
    },
  };
}
