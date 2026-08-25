import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";

const apiDirectory = path.join(
  process.cwd(),
  "src",
  "app",
  "api",
  "projects",
  "[projektId]",
  "media"
);
const collectionRoute = readFileSync(path.join(apiDirectory, "route.ts"), "utf8");
const itemRoute = readFileSync(
  path.join(apiDirectory, "[mediaId]", "route.ts"),
  "utf8"
);
const prismaSchema = readFileSync(
  path.join(process.cwd(), "prisma", "schema.prisma"),
  "utf8"
);

test("project media persistence has tenant-local uniqueness and cascading ownership", () => {
  assert.match(prismaSchema, /mediaReplacements\s+ProjectMediaReplacement\[\]/);
  assert.match(
    prismaSchema,
    /model ProjectMediaReplacement\s*\{[\s\S]*?onDelete:\s*Cascade[\s\S]*?@@unique\(\[projectId, langTo, originalUrl\]\)[\s\S]*?@@index\(\[projectId, langTo\]\)/
  );
});

test("project image creation validates active tenant languages and same-project paths", () => {
  assert.match(
    collectionRoute,
    /projectLanguage\.findFirst\(\{[\s\S]*?projectId:\s*projektId[\s\S]*?langCode:\s*parsed\.data\.langTo[\s\S]*?isActive:\s*true/
  );
  assert.match(collectionRoute, /project:\s*\{\s*select:\s*\{\s*domain:\s*true/);
  assert.match(
    collectionRoute,
    /originalUrl:\s*normalizeMediaImageUrl\([\s\S]*?projectDomain/
  );
  assert.match(
    collectionRoute,
    /localizedUrl:\s*normalizeMediaImageUrl\([\s\S]*?projectDomain/
  );
  assert.doesNotMatch(collectionRoute, /\b(?:fetch|axios|undici)\s*\(/);
});

test("project image creation enforces the runtime cap in a retryable serializable transaction", () => {
  assert.match(collectionRoute, /\$transaction\(/);
  assert.match(
    collectionRoute,
    /projectMediaReplacement\.count\(\{\s*where:\s*\{\s*projectId:\s*projektId/
  );
  assert.match(collectionRoute, /assertMediaReplacementCapacity\(/);
  assert.match(collectionRoute, /TransactionIsolationLevel\.Serializable/);
  assert.match(collectionRoute, /P2034/);
  assert.match(collectionRoute, /MEDIA_REPLACEMENTS_LIMIT_EXCEEDED/);
  assert.match(collectionRoute, /status:\s*409/);
});

test("manager image listing remains bounded while legacy overflow stays recoverable", () => {
  assert.match(
    collectionRoute,
    /take:\s*MAX_RUNTIME_MEDIA_REPLACEMENTS\s*\+\s*1/
  );
  assert.match(collectionRoute, /limitExceeded/);
});

test("image updates and deletion retain tenant ownership on every resource lookup", () => {
  assert.match(
    itemRoute,
    /projectMediaReplacement\.findFirst\(\{\s*where:\s*\{\s*id:\s*mediaId,\s*projectId:\s*projektId/
  );
  assert.match(
    itemRoute,
    /projectMediaReplacement\.update\(\{\s*where:\s*\{\s*id:\s*mediaId,\s*projectId:\s*projektId/
  );
  assert.match(
    itemRoute,
    /projectMediaReplacement\.deleteMany\(\{\s*where:\s*\{\s*id:\s*mediaId,\s*projectId:\s*projektId/
  );
  assert.match(
    itemRoute,
    /projectLanguage\.findFirst\(\{\s*where:\s*\{\s*projectId:\s*projektId,\s*langCode:\s*langTo,\s*isActive:\s*true/
  );
  assert.match(itemRoute, /status:\s*404/);
  assert.match(itemRoute, /error\.code === "P2002"/);
});

test("image management errors expose stable machine-readable causes", () => {
  for (const code of [
    "inactive_target_language",
    "invalid_media_image_url",
    "media_replacement_already_exists",
    "media_replacements_limit_exceeded",
    "media_replacement_create_failed",
  ]) {
    assert.match(collectionRoute, new RegExp(`code:\\s*"${code}"`));
  }

  for (const code of [
    "media_replacement_not_found",
    "inactive_target_language",
    "invalid_media_image_url",
    "media_replacement_already_exists",
    "media_replacement_update_failed",
  ]) {
    assert.match(itemRoute, new RegExp(`code:\\s*"${code}"`));
  }
});
