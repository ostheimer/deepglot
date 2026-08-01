import test from "node:test";
import assert from "node:assert/strict";

import { getBlogArticleRedirectPath } from "@/lib/blog";
import { localizeBlogArticlePathname } from "@/lib/blog-routes";

test("maps blog article slugs when switching between German and other locales", () => {
  assert.equal(
    localizeBlogArticlePathname(
      "/de/blog/wordpress-uebersetzen-ohne-lock-in",
      "en"
    ),
    "/de/blog/wordpress-translation-without-lock-in"
  );
  assert.equal(
    localizeBlogArticlePathname(
      "/fr/blog/translated-url-slugs-for-wordpress",
      "de"
    ),
    "/fr/blog/uebersetzte-url-slugs-fuer-wordpress"
  );
});

test("leaves non-blog routes unchanged", () => {
  assert.equal(localizeBlogArticlePathname("/de/preise", "en"), "/de/preise");
});

test("redirects non-canonical blog slugs to the localized article slug", () => {
  assert.equal(
    getBlogArticleRedirectPath(
      "de",
      "wordpress-translation-without-lock-in"
    ),
    "/de/blog/wordpress-uebersetzen-ohne-lock-in"
  );
  assert.equal(
    getBlogArticleRedirectPath(
      "fr",
      "uebersetzte-url-slugs-fuer-wordpress"
    ),
    "/blog/translated-url-slugs-for-wordpress"
  );
  assert.equal(
    getBlogArticleRedirectPath(
      "fr",
      "translated-url-slugs-for-wordpress"
    ),
    "/blog/translated-url-slugs-for-wordpress"
  );
  assert.equal(
    getBlogArticleRedirectPath(
      "de",
      "wordpress-uebersetzen-ohne-lock-in"
    ),
    null
  );
});
