import assert from "node:assert/strict";
import test from "node:test";

import {
  buildMarketingMetadata,
  buildPageMetadata,
} from "@/lib/marketing-metadata";
import { generateMetadata as generateBlogMetadata } from "@/app/blog/page";
import { generateMetadata as generateDocsMetadata } from "@/app/docs/page";

test("marketing metadata carries complete Open Graph and Twitter cards", () => {
  const metadata = buildMarketingMetadata({
    locale: "de",
    route: "pricing",
    title: "Preise",
    description: "Deepglot Preise",
  });

  assert.deepEqual(metadata.alternates?.canonical, "/de/preise");
  assert.deepEqual(metadata.openGraph, {
    type: "website",
    locale: "de_DE",
    url: "/de/preise",
    siteName: "Deepglot",
    title: "Preise",
    description: "Deepglot Preise",
    images: [
      {
        url: "/opengraph-image.png",
        width: 1200,
        height: 630,
        alt: "Deepglot — WordPress translation built in Austria",
      },
    ],
  });
  assert.deepEqual(metadata.twitter, {
    card: "summary_large_image",
    title: "Preise",
    description: "Deepglot Preise",
    images: [
      {
        url: "/opengraph-image.png",
        width: 1200,
        height: 630,
        alt: "Deepglot — WordPress translation built in Austria",
      },
    ],
  });
});

test("editorial metadata can publish an EN/DE-only article canonical", () => {
  const metadata = buildPageMetadata({
    locale: "en",
    title: "Article",
    description: "Article description",
    canonical: "/blog/article",
    languages: {
      en: "/blog/article",
      de: "/de/blog/artikel",
      "x-default": "/blog/article",
    },
    article: { publishedTime: "2026-08-01T00:00:00.000Z" },
  });

  assert.equal(
    (metadata.openGraph as { type?: string } | null | undefined)?.type,
    "article"
  );
  assert.deepEqual(metadata.alternates?.languages, {
    en: "/blog/article",
    de: "/de/blog/artikel",
    "x-default": "/blog/article",
  });
  assert.deepEqual(metadata.twitter, {
    card: "summary_large_image",
    title: "Article",
    description: "Article description",
    images: [
      {
        url: "/opengraph-image.png",
        width: 1200,
        height: 630,
        alt: "Deepglot — WordPress translation built in Austria",
      },
    ],
  });
});

test("unsupported blog and documentation locales point only to real EN/DE variants", async () => {
  const searchParams = Promise.resolve({ __locale: "fr" });
  const [blogMetadata, docsMetadata] = await Promise.all([
    generateBlogMetadata({ searchParams }),
    generateDocsMetadata({ searchParams }),
  ]);

  assert.equal(blogMetadata.alternates?.canonical, "/blog");
  assert.deepEqual(blogMetadata.alternates?.languages, {
    en: "/blog",
    de: "/de/blog",
    "x-default": "/blog",
  });
  assert.equal(docsMetadata.alternates?.canonical, "/docs");
  assert.deepEqual(docsMetadata.alternates?.languages, {
    en: "/docs",
    de: "/de/dokumentation",
    "x-default": "/docs",
  });
});
