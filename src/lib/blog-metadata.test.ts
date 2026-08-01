import assert from "node:assert/strict";
import test from "node:test";

import { buildBlogArticleStructuredData } from "@/lib/blog-metadata";

test("blog structured data publishes absolute canonical image and publisher URLs", () => {
  const structuredData = buildBlogArticleStructuredData({
    title: "Aus Österreich",
    description: "Deepglot",
    publishedAt: "2026-08-01",
    contentLocale: "de",
    canonicalPath: "/de/blog/aus-oesterreich-fuer-24-sprachen",
  });

  assert.equal(structuredData.inLanguage, "de-DE");
  assert.equal(
    structuredData.image,
    "https://deepglot.ai/opengraph-image.png"
  );
  assert.deepEqual(structuredData.mainEntityOfPage, {
    "@type": "WebPage",
    "@id": "https://deepglot.ai/de/blog/aus-oesterreich-fuer-24-sprachen",
  });
  assert.deepEqual(structuredData.publisher.logo, {
    "@type": "ImageObject",
    url: "https://deepglot.ai/icon.png",
    width: 512,
    height: 512,
  });
});
