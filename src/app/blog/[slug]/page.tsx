import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { BlogArticle } from "@/components/marketing/blog-article";
import {
  getAllBlogSlugs,
  getBlogArticlePath,
  getBlogPost,
  getBlogPosts,
} from "@/lib/blog";
import { getPageLocale, type LocaleSearchParams } from "@/lib/request-locale";
import {
  SITE_LOCALE_METADATA,
  SITE_LOCALES,
} from "@/lib/site-locale";

type BlogArticlePageProps = {
  params: Promise<{ slug: string }>;
  searchParams: LocaleSearchParams;
};

export function generateStaticParams() {
  return getAllBlogSlugs().map((slug) => ({ slug }));
}

export async function generateMetadata({ params, searchParams }: BlogArticlePageProps): Promise<Metadata> {
  const [{ slug }, locale] = await Promise.all([params, getPageLocale(searchParams)]);
  const post = getBlogPost(locale, slug);

  if (!post) return {};

  const languageAlternates = Object.fromEntries(
    SITE_LOCALES.map((siteLocale) => {
      const localizedPost = getBlogPosts(siteLocale).find((candidate) => candidate.id === post.id)!;
      return [siteLocale, getBlogArticlePath(siteLocale, localizedPost.slug)];
    })
  );
  const canonical = getBlogArticlePath(locale, post.slug);

  return {
    title: post.copy.title,
    description: post.copy.excerpt,
    alternates: {
      canonical,
      languages: {
        ...languageAlternates,
        "x-default": languageAlternates.en,
      },
    },
    openGraph: {
      type: "article",
      locale: SITE_LOCALE_METADATA[locale].openGraphLocale,
      url: canonical,
      title: post.copy.title,
      description: post.copy.excerpt,
      publishedTime: `${post.publishedAt}T00:00:00.000Z`,
    },
  };
}

export default async function BlogArticlePage({ params, searchParams }: BlogArticlePageProps) {
  const [{ slug }, locale] = await Promise.all([params, getPageLocale(searchParams)]);
  const post = getBlogPost(locale, slug);

  if (!post) notFound();

  const posts = getBlogPosts(locale);
  const index = posts.findIndex((candidate) => candidate.id === post.id);
  const nextPost = posts[(index + 1) % posts.length];
  const articleUrl = getBlogArticlePath(locale, post.slug);

  const structuredData = {
    "@context": "https://schema.org",
    "@type": "Article",
    headline: post.copy.title,
    description: post.copy.excerpt,
    datePublished: post.publishedAt,
    dateModified: post.publishedAt,
    inLanguage: locale,
    mainEntityOfPage: articleUrl,
    author: { "@type": "Organization", name: "Deepglot" },
    publisher: { "@type": "Organization", name: "Ostheimer OG" },
  };

  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(structuredData) }}
      />
      <BlogArticle locale={locale} post={post} nextPost={nextPost} />
    </>
  );
}
