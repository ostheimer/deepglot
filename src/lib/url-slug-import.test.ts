import assert from "node:assert/strict";
import test from "node:test";
import { planUrlSlugImport, UrlSlugImportConflict } from "@/lib/url-slug-import";

const existing = [
  { id: "a", originalSlug: "ueber-uns", translatedSlug: "about-us", langTo: "en" },
  { id: "b", originalSlug: "kontakt", translatedSlug: null, langTo: "en" },
];

test("CSV accepts a direct edit export and a later reset", () => {
  assert.deepEqual(planUrlSlugImport([
    { line: 2, originalSlug: "ueber-uns", translatedSlug: "about-us", langTo: "en", urlCount: 3 },
  ], existing)[0].translatedSlug, "about-us");
  assert.deepEqual(planUrlSlugImport([
    { line: 2, originalSlug: "ueber-uns", translatedSlug: "", langTo: "en", urlCount: 3 },
  ], existing)[0].translatedSlug, "");
});

test("CSV reports exact line and conflicting source or target", () => {
  for (const target of ["kontakt", "about-us", "wp-admin"]) {
    assert.throws(() => planUrlSlugImport([
      { line: 8, originalSlug: "neu", translatedSlug: target, langTo: "en", urlCount: 1 },
    ], existing), (error: unknown) => {
      assert.ok(error instanceof UrlSlugImportConflict);
      assert.equal(error.line, 8);
      assert.equal(error.target, target);
      return true;
    });
  }
});

test("CSV catches duplicate and cross-row claims before any write", () => {
  assert.throws(() => planUrlSlugImport([
    { line: 2, originalSlug: "eins", translatedSlug: "zwei", langTo: "en", urlCount: 0 },
    { line: 3, originalSlug: "zwei", translatedSlug: "three", langTo: "en", urlCount: 0 },
  ], existing), (error: unknown) => error instanceof UrlSlugImportConflict && error.line === 2);
  assert.throws(() => planUrlSlugImport([
    { line: 2, originalSlug: "eins", translatedSlug: "one", langTo: "en", urlCount: 0 },
    { line: 3, originalSlug: "eins", translatedSlug: "one", langTo: "en", urlCount: 0 },
  ], existing), (error: unknown) => error instanceof UrlSlugImportConflict && error.line === 3);
});

test("CSV rejects a normalized source alias of an existing row even without a target", () => {
  assert.throws(() => planUrlSlugImport([
    { line: 4, originalSlug: "kont%61kt", translatedSlug: "", langTo: "en", urlCount: 1 },
  ], existing), (error: unknown) => error instanceof UrlSlugImportConflict && error.line === 4);
});

test("CSV rejects an existing language-code casing alias before an upsert creates a duplicate", () => {
  assert.throws(() => planUrlSlugImport([
    { line: 5, originalSlug: "kontakt", translatedSlug: "contact", langTo: "en", urlCount: 1 },
  ], [{ id: "legacy", originalSlug: "kontakt", translatedSlug: null, langTo: "EN" }]),
  (error: unknown) => error instanceof UrlSlugImportConflict && error.line === 5);
});
