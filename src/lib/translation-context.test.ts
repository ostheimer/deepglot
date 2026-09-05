import assert from "node:assert/strict";
import { test } from "node:test";
import { STATIC_MESSAGES } from "./static-messages";
import { SITE_LOCALES } from "./site-locale";
import {
  translationContextPath,
  translationContextLink,
} from "./translation-context";

test("context links use HTTP for normalized local project domains", () => {
  for (const domain of ["localhost:3100", "127.0.0.1:8787", "localhost:80"]) {
    const expected = new URL('/prices', `http://${domain}`).href;
    assert.equal(translationContextLink(domain, "/prices"), expected);
    assert.equal(translationContextPath(expected, domain), "/prices");
  }
});

test("context page-count label exists in every non-English catalogue", () => {
  for (const locale of SITE_LOCALES.filter(locale => locale !== "en")) {
    assert.ok(STATIC_MESSAGES[locale]?.Pages, `Missing Pages label: ${locale}`);
  }
});

test("page context removes query strings and fragments", () => {
  assert.equal(
    translationContextPath(
      "https://example.test/prices?email=private#token",
      "example.test",
    ),
    "/prices",
  );
  assert.equal(
    translationContextPath("https://example.test/", "https://example.test"),
    "/",
  );
});

test("page links cannot change the site origin or retain private query data", () => {
  assert.equal(
    translationContextLink("example.test", "/prices"),
    "https://example.test/prices",
  );
  for (const path of [
    "//evil.test",
    "https://evil.test/",
    "/prices?token=x",
    "/prices#secret",
    "/%00",
  ]) {
    assert.equal(translationContextLink("example.test", path), null);
  }
  assert.equal(translationContextLink("javascript:alert(1)", "/"), null);
});

test("page context rejects unsafe or unrelated navigation", () => {
  for (const url of [
    "https://evil.test/page",
    "javascript:alert(1)",
    "https://user:pass@example.test/",
    "https://example.test//evil.test",
    "https://example.test/%00",
    "https://example.test/%5cfoo",
    "https://example.test/%ZZ",
    "https://example.test:8080/",
    "/relative",
  ]) {
    assert.equal(translationContextPath(url, "example.test"), null, url);
  }
});
