import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";

const route = readFileSync(
  path.join(process.cwd(), "src/app/api/plugin/settings-sync/route.ts"),
  "utf8"
);

test("plugin settings sync bounds the entire language-activation transaction", () => {
  assert.match(route, /from "@\/lib\/media-runtime-limits"/);
  assert.match(
    route,
    /withBoundedMediaRuntimeMutation\(\s*tx,\s*projectId,\s*async\s*\(\)\s*=>/
  );

  const guardStart = route.indexOf("withBoundedMediaRuntimeMutation(");
  for (const operation of [
    "tx.project.update(",
    "tx.projectLanguage.findMany(",
    "tx.projectLanguage.updateMany(",
    "tx.projectLanguage.create(",
    "tx.projectSettings.upsert(",
    "tx.projectDomainMapping.deleteMany(",
  ]) {
    assert.ok(
      route.indexOf(operation, guardStart) > guardStart,
      `${operation} must remain inside the bounded settings transaction`
    );
  }
});

test("plugin settings sync retries serializable language and image races", () => {
  assert.match(route, /MAX_SERIALIZATION_RETRIES\s*=\s*3/);
  assert.match(route, /TransactionIsolationLevel\.Serializable/);
  assert.match(route, /error\.code\s*===\s*"P2034"/);
  assert.match(route, /attempt\s*<\s*MAX_SERIALIZATION_RETRIES\s*-\s*1/);
});

test("oversized language reactivation returns a stable plugin Problem Details response", () => {
  assert.match(route, /error\s+instanceof\s+MediaRuntimePayloadLimitError/);
  assert.match(route, /code:\s*"media_replacements_payload_too_large"/);
  assert.match(route, /extensions:\s*\{\s*limit:\s*MAX_RUNTIME_MEDIA_REPLACEMENTS_BYTES\s*\}/);
  assert.match(route, /status:\s*409/);
  assert.match(route, /code:\s*"domain_mapping_conflict"/);
});

test("legacy active-image overflow remains a stable recoverable plugin conflict", () => {
  assert.match(route, /error\s+instanceof\s+MediaReplacementError/);
  assert.match(route, /error\.code\s*===\s*"MEDIA_REPLACEMENTS_LIMIT_EXCEEDED"/);
  assert.match(route, /code:\s*"media_replacements_limit_exceeded"/);
  assert.match(route, /extensions:\s*\{\s*limit:\s*MAX_RUNTIME_MEDIA_REPLACEMENTS\s*\}/);
});
