import test from "node:test";
import assert from "node:assert/strict";

import {
  getAllBlogSlugs,
  getBlogArticlePath,
  getBlogPost,
  getBlogPosts,
} from "@/lib/blog";
import { SITE_LOCALES } from "@/lib/site-locale";

test("publishes a stable archive for every supported site locale", () => {
  for (const locale of SITE_LOCALES) {
    const posts = getBlogPosts(locale);
    assert.equal(posts.length, 3, locale);
    assert.equal(new Set(posts.map((post) => post.id)).size, posts.length, locale);
  }
});

test("uses German article slugs and copy on German routes", () => {
  const post = getBlogPosts("de")[0];

  assert.equal(post.slug, "wordpress-uebersetzen-ohne-lock-in");
  assert.match(post.copy.title, /übersetzen/);
  assert.equal(
    getBlogArticlePath("de", post.slug),
    "/de/blog/wordpress-uebersetzen-ohne-lock-in"
  );
});

test("resolves both localized slug variants without duplicate identifiers", () => {
  for (const slug of getAllBlogSlugs()) {
    assert.ok(getBlogPost("en", slug), slug);
  }

  assert.equal(getBlogPost("en", "not-a-real-article"), null);
});
