import assert from "node:assert/strict";
import test from "node:test";
import { classifyUrlTranslation, createUrlOperationFingerprint, glossaryRuleVersion, managerProviderOutcome, wordpressCacheKey } from "./url-operations";

test("URL deletion protects shared, manual, and reviewed segments", () => {
  assert.equal(classifyUrlTranslation({ isManual: false, workflowStatus: "MACHINE", paths: ["/one"] }, "/one"), "delete");
  assert.equal(classifyUrlTranslation({ isManual: false, workflowStatus: "MACHINE", paths: ["/one", "/two"] }, "/one"), "shared");
  assert.equal(classifyUrlTranslation({ isManual: true, workflowStatus: "MACHINE", paths: ["/one"] }, "/one"), "protected");
  assert.equal(classifyUrlTranslation({ isManual: false, workflowStatus: "APPROVED", paths: ["/one"] }, "/one"), "protected");
  assert.equal(classifyUrlTranslation({ isManual: false, workflowStatus: "MACHINE", paths: ["/one"], glossaryProtected: true }, "/one"), "protected");
});

test("invalidation digest matches the WordPress transient identity without storing text", () => {
  assert.equal(wordpressCacheKey("de", "en", "Änderung"), "b8b4b98e0acbde70771140308f16597155d928c3");
});

test("confirmation identity changes when source content, context, status or quota limit changes", () => {
  const base = { projectId: "p", action: "retranslate", urlIds: ["u"], segments: [{ id: "t", updatedAt: "2026-10-09T00:00:00Z", paths: ["/one"] }], wordsLimit: 100 };
  const token = createUrlOperationFingerprint(base);
  assert.notEqual(token, createUrlOperationFingerprint({ ...base, wordsLimit: 200 }));
  assert.notEqual(token, createUrlOperationFingerprint({ ...base, segments: [{ ...base.segments[0], paths: ["/one", "/two"] }] }));
  assert.notEqual(token, createUrlOperationFingerprint({ ...base, segments: [{ ...base.segments[0], updatedAt: "2026-10-09T00:00:01Z" }] }));
});

test("a provider-dispatched error stays unresolved regardless of HTTP 4xx or 5xx", () => {
  for (const responseStatus of [400, 429, 500]) {
    assert.equal(managerProviderOutcome({ providerDispatched: true, receiptPersisted: false, responseStatus }), "unknown");
  }
  assert.equal(managerProviderOutcome({ providerDispatched: false, receiptPersisted: false, responseStatus: 429 }), "rejected_before_provider");
  assert.equal(managerProviderOutcome({ providerDispatched: true, receiptPersisted: true, responseStatus: 500 }), "completed");
});

test("glossary revisions are order-independent but reject a new matching rule", () => {
  const first = { id: "a", updatedAt: new Date("2026-10-09T00:00:00Z") };
  const second = { id: "b", updatedAt: new Date("2026-10-09T00:00:01Z") };
  assert.equal(glossaryRuleVersion([first, second]), glossaryRuleVersion([second, first]));
  assert.notEqual(glossaryRuleVersion([first]), glossaryRuleVersion([first, second]));
  assert.notEqual(glossaryRuleVersion([first]), glossaryRuleVersion([{ ...first, updatedAt: second.updatedAt }]));
});
