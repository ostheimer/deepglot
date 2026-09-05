import assert from "node:assert/strict";
import { test } from "node:test";
import {
  translationContextPath,
  translationContextLink,
} from "./translation-context";

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
