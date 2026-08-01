import type { Metadata } from "next";
import { notFound, permanentRedirect } from "next/navigation";

import { BlogArticle } from "@/components/marketing/blog-article";
import {
  getAllBlogSlugs,
  getBlogArticlePath,
  getBlogArticleRedirectPath,
  getBlogPost,
  getBlogPosts,
} from "@/lib/blog";
import { buildBlogArticleStructuredData } from "@/lib/blog-metadata";
import { buildPageMetadata } from "@/lib/marketing-metadata";
import { getPageLocale, type LocaleSearchParams } from "@/lib/request-locale";

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

  const contentLocale = locale === "de" ? "de" : "en";
  const canonicalPost = getBlogPosts(contentLocale).find(
    (candidate) => candidate.id === post.id
  )!;
  const languageAlternates = Object.fromEntries(
    (["en", "de"] as const).map((siteLocale) => {
      const localizedPost = getBlogPosts(siteLocale).find((candidate) => candidate.id === post.id)!;
      return [siteLocale, getBlogArticlePath(siteLocale, localizedPost.slug)];
    })
  );
  const canonical = getBlogArticlePath(contentLocale, canonicalPost.slug);

  return buildPageMetadata({
    locale: contentLocale,
    title: post.copy.title,
    description: post.copy.excerpt,
    canonical,
    languages: {
      ...languageAlternates,
      "x-default": languageAlternates.en,
    },
    article: {
      publishedTime: `${post.publishedAt}T00:00:00.000Z`,
    },
  });
}

export default async function BlogArticlePage({ params, searchParams }: BlogArticlePageProps) {
  const [{ slug }, locale] = await Promise.all([params, getPageLocale(searchParams)]);
  const post = getBlogPost(locale, slug);

  if (!post) notFound();
  const redirectPath = getBlogArticleRedirectPath(locale, slug);
  if (redirectPath) {
    permanentRedirect(redirectPath);
  }

  const posts = getBlogPosts(locale);
  const index = posts.findIndex((candidate) => candidate.id === post.id);
  const nextPost = posts[(index + 1) % posts.length];
  const contentLocale = locale === "de" ? "de" : "en";
  const canonicalPost = getBlogPosts(contentLocale).find(
    (candidate) => candidate.id === post.id
  )!;
  const structuredData = buildBlogArticleStructuredData({
    title: post.copy.title,
    description: post.copy.excerpt,
    publishedAt: post.publishedAt,
    contentLocale,
    canonicalPath: getBlogArticlePath(contentLocale, canonicalPost.slug),
  });

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
