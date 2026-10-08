import assert from "node:assert/strict";
import test from "node:test";
import { validateUrlSlugEdit } from "@/lib/url-slug-edit";

const rows = [
  { id: "a", originalSlug: "ueber-uns", translatedSlug: "about-us", langTo: "en" },
  { id: "b", originalSlug: "kontakt", translatedSlug: null, langTo: "en" },
  { id: "c", originalSlug: "preise", translatedSlug: "pricing", langTo: "en" },
];

test("normalizes a valid single URL segment", () => {
  assert.equal(validateUrlSlugEdit("  Über-Uns  ", "a", rows), "über-uns");
});

test("rejects reserved WordPress paths, path separators and invalid UTF-8", () => {
  for (const target of ["wp%2Dadmin", "foo/bar", "foo%2Fbar", "foo%00bar", "foo%252fbar", "%FF"]) {
    assert.throws(() => validateUrlSlugEdit(target, "a", rows));
  }
});

test("rejects translated and original reservations after one percent decode", () => {
  for (const target of ["PRICING", "kontakt", "kont%61kt"]) {
    assert.throws(() => validateUrlSlugEdit(target, "a", rows));
  }
});

test("a cleared mapping remains a reserved source path", () => {
  assert.equal(validateUrlSlugEdit(null, "a", rows), null);
  assert.throws(() => validateUrlSlugEdit("ueber-uns", "c", rows));
});

test("only accepts a target the runtime payload will emit", () => {
  const duplicateOriginals = [
    { id: "a", originalSlug: "FOO", translatedSlug: null, langTo: "en" },
    { id: "b", originalSlug: "foo", translatedSlug: null, langTo: "en" },
  ];
  assert.throws(() => validateUrlSlugEdit("new-target", "a", duplicateOriginals));
  assert.throws(() => validateUrlSlugEdit("new-target", "b", [
    { id: "a", originalSlug: "wp-admin", translatedSlug: null, langTo: "en" },
    { id: "b", originalSlug: "wp-json", translatedSlug: null, langTo: "en" },
  ]));
});

test("numeric segments are valid content mappings", () => {
  assert.equal(validateUrlSlugEdit("1279", "a", rows), "1279");
});

test("rejects a new mapping when the original cannot be routed by WordPress", () => {
  for (const originalSlug of ["bad/path", "x".repeat(201), "foo%2Fbar", "."]) {
    const malformed = [{ id: "a", originalSlug, translatedSlug: null, langTo: "en" }];
    assert.throws(() => validateUrlSlugEdit("new-target", "a", malformed), originalSlug);
    assert.equal(validateUrlSlugEdit(null, "a", malformed), null, "reset remains available");
  }
});
