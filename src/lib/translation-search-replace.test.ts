import assert from "node:assert/strict";
import { test } from "node:test";
import { planWorkspaceReplacement, replacementFingerprint, assertProtectedWorkspaceText } from "./translation-search-replace";

test("AI suggestions may change prose but cannot remove or invent structural content", () => {
  assert.doesNotThrow(() => assertProtectedWorkspaceText("Hallo {name}",
    '<a href="https://example.org">Hello {name} Gold</a>',
    '<a href="https://example.org">Hi {name} Gold</a>', ["Gold"]));
  assert.throws(() => assertProtectedWorkspaceText("Hallo {name}",
    "Hello {name}", "Hi {other}", []), /protected/i);
  assert.throws(() => assertProtectedWorkspaceText("Hallo {name}",
    "Hello {name} Gold", "Hi {name} Silver", ["Gold"]), /protected/i);
});

test("literal replacement protects placeholders, links, tags and glossary terms", () => {
  const base = { originalText: "Hallo {name}", translatedText: "Hello {name}", find: "Hello", replace: "Hi", glossaryTerms: [] };
  assert.equal(planWorkspaceReplacement(base), "Hi {name}");
  assert.throws(() => planWorkspaceReplacement({ ...base, find: "{name}", replace: "{person}" }), /protected/i);
  assert.throws(() => planWorkspaceReplacement({ ...base, find: "Hello", replace: "Hi {new}" }), /protected/i);
  assert.throws(() => planWorkspaceReplacement({ ...base, translatedText: '<a href="https://example.org">Hello</a>', find: "example.org", replace: "evil.org" }), /protected/i);
  assert.throws(() => planWorkspaceReplacement({ ...base, translatedText: "Hello Gold", find: "Gold", replace: "Silver", glossaryTerms: ["Gold"] }), /protected/i);
  assert.equal(planWorkspaceReplacement({ ...base, find: "Hell", replace: "Hall" }), "Hallo {name}");
});

test("replacement fingerprint binds ordered selected revisions and proposed text", () => {
  const input = { projectId: "p", userId: "u", find: "Hello", replace: "Hi", rows: [{ id: "a", updatedAt: "2026-01-01T00:00:00Z", before: "Hello", after: "Hi" }] };
  const first = replacementFingerprint(input);
  assert.equal(first, replacementFingerprint(input));
  assert.notEqual(first, replacementFingerprint({ ...input, rows: [{ ...input.rows[0], before: "Hello!" }] }));
  assert.notEqual(first, replacementFingerprint({ ...input, userId: "other" }));
  assert.notEqual(first, replacementFingerprint({ ...input, includeReviewed: true }));
});
