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
  "media",
);
const collectionRoute = readFileSync(
  path.join(apiDirectory, "route.ts"),
  "utf8",
);
const itemRoute = readFileSync(
  path.join(apiDirectory, "[mediaId]", "route.ts"),
  "utf8",
);
const runtimeRoute = readFileSync(
  path.join(
    process.cwd(),
    "src",
    "app",
    "api",
    "plugin",
    "runtime-config",
    "route.ts",
  ),
  "utf8",
);
const languageRoute = readFileSync(
  path.join(apiDirectory, "..", "languages", "route.ts"),
  "utf8",
);
const languageMutations = readFileSync(
  path.join(process.cwd(), "src", "lib", "project-language-mutations.ts"),
  "utf8",
);
const generalSettings = readFileSync(
  path.join(process.cwd(), "src", "lib", "project-general-settings.ts"),
  "utf8",
);
const projectRoute = readFileSync(
  path.join(apiDirectory, "..", "route.ts"),
  "utf8",
);
const prismaSchema = readFileSync(
  path.join(process.cwd(), "prisma", "schema.prisma"),
  "utf8",
);

test("project media persistence has tenant-local uniqueness and cascading ownership", () => {
  assert.match(prismaSchema, /mediaReplacements\s+ProjectMediaReplacement\[\]/);
  assert.match(
    prismaSchema,
    /model ProjectMediaReplacement\s*\{[\s\S]*?onDelete:\s*Cascade[\s\S]*?@@unique\(\[projectId, langTo, originalUrl\]\)[\s\S]*?@@index\(\[projectId, langTo\]\)/,
  );
});

test("project image creation validates active tenant languages and same-project paths", () => {
  assert.match(
    collectionRoute,
    /projectLanguage\.findFirst\(\{[\s\S]*?projectId:\s*projektId[\s\S]*?langCode:\s*\{\s*equals:\s*parsed\.data\.langTo,?\s*mode:\s*"insensitive",?\s*\}[\s\S]*?isActive:\s*true/,
  );
  assert.match(
    collectionRoute,
    /project:\s*\{\s*select:\s*\{\s*domain:\s*true/,
  );
  assert.match(
    collectionRoute,
    /originalUrl:\s*normalizeMediaImageUrl\([\s\S]*?projectDomain/,
  );
  assert.match(
    collectionRoute,
    /localizedUrl:\s*normalizeMediaImageUrl\([\s\S]*?projectDomain/,
  );
  assert.doesNotMatch(collectionRoute, /\b(?:fetch|axios|undici)\s*\(/);
});

test("project image creation enforces the runtime cap in a retryable serializable transaction", () => {
  assert.match(collectionRoute, /\$transaction\(/);
  assert.match(
    collectionRoute,
    /projectMediaReplacement\.count\(\{\s*where:\s*\{\s*projectId:\s*projektId/,
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
    /take:\s*MAX_RUNTIME_MEDIA_REPLACEMENTS\s*\+\s*1/,
  );
  assert.match(collectionRoute, /limitExceeded/);
});

test("image updates and deletion retain tenant ownership on every resource lookup", () => {
  assert.match(
    itemRoute,
    /projectMediaReplacement\.findFirst\(\{\s*where:\s*\{\s*id:\s*mediaId,\s*projectId:\s*projektId/,
  );
  assert.match(
    itemRoute,
    /projectMediaReplacement\.update\(\{\s*where:\s*\{\s*id:\s*mediaId,\s*projectId:\s*projektId/,
  );
  assert.match(
    itemRoute,
    /projectMediaReplacement\.deleteMany\(\{\s*where:\s*\{\s*id:\s*mediaId,\s*projectId:\s*projektId/,
  );
  assert.match(
    itemRoute,
    /projectLanguage\.findFirst\(\{\s*where:\s*\{\s*projectId:\s*projektId,\s*langCode:\s*\{\s*equals:\s*langTo,?\s*mode:\s*"insensitive",?\s*\},\s*isActive:\s*true/,
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

test("POST and PATCH reject oversized active runtime mappings before their transaction commits", () => {
  assert.match(
    collectionRoute,
    /withBoundedMediaRuntimeMutation\(\s*tx,\s*projektId/,
  );
  assert.match(
    itemRoute,
    /withBoundedMediaRuntimeMutation\(\s*tx,\s*projektId/,
  );
  assert.match(collectionRoute, /media_replacements_payload_too_large/);
  assert.match(itemRoute, /media_replacements_payload_too_large/);
  assert.match(runtimeRoute, /from "@\/lib\/media-runtime-limits"/);
  assert.doesNotMatch(
    runtimeRoute,
    /MAX_RUNTIME_MEDIA_REPLACEMENTS_BYTES\s*=\s*229_376/,
  );
});

test("media creates and patches share the project lock with language activation before runtime validation", () => {
  for (const route of [collectionRoute, itemRoute]) {
    assert.match(
      route,
      /from "@\/lib\/project-runtime-configuration-lock"/,
    );
    assert.match(
      route,
      /await lockProjectRuntimeConfiguration\(tx,\s*projektId\)/,
    );
    assert.ok(
      route.indexOf("lockProjectRuntimeConfiguration(tx, projektId)") <
        route.indexOf("withBoundedMediaRuntimeMutation(tx, projektId"),
      "the shared project lock must be acquired before the bounded runtime snapshot",
    );
  }
});

test("concurrent partial image updates serialize, retry write conflicts and never overwrite omitted fields", () => {
  assert.match(itemRoute, /TransactionIsolationLevel\.Serializable/);
  assert.match(itemRoute, /P2034/);
  assert.match(itemRoute, /parsed\.data\.originalUrl\s*!==\s*undefined/);
  assert.match(itemRoute, /parsed\.data\.localizedUrl\s*!==\s*undefined/);
  assert.match(itemRoute, /parsed\.data\.langTo\s*!==\s*undefined/);
  assert.doesNotMatch(
    itemRoute,
    /originalUrl:\s*normalizeMediaImageUrl\(\s*parsed\.data\.originalUrl\s*\?\?\s*existing\.originalUrl/,
  );
  assert.doesNotMatch(
    itemRoute,
    /localizedUrl:\s*normalizeMediaImageUrl\(\s*parsed\.data\.localizedUrl\s*\?\?\s*existing\.localizedUrl/,
  );
});

test("language reactivation preserves manager access and duplicate handling while enforcing the project-wide image runtime ceiling", () => {
  assert.match(languageRoute, /userCanManageProject\(userId,\s*projektId\)/);
  assert.match(languageRoute, /addProjectTargetLanguages\(db,/);
  assert.match(
    languageMutations,
    /withBoundedMediaRuntimeMutation\(\s*tx,\s*projectId/,
  );
  assert.match(languageMutations, /projectLanguage\.createMany\(/);
  assert.match(languageMutations, /skipDuplicates:\s*true/);
  assert.match(languageMutations, /TransactionIsolationLevel\.ReadCommitted/);
  assert.match(languageMutations, /isProjectRuntimeSerializationConflict/);
  assert.match(languageRoute, /media_replacements_payload_too_large/);
  assert.match(languageRoute, /status:\s*409/);
  assert.match(languageMutations, /projectLanguage\.deleteMany\(/);
});

test("dashboard language activation revives existing inactive rows and rejects the 501-image sentinel with a stable conflict", () => {
  assert.match(
    languageMutations,
    /projectLanguage\.updateMany\(\{[\s\S]*?projectId[\s\S]*?langCode:\s*\{\s*in:\s*languages[\s\S]*?data:\s*\{\s*isActive:\s*true/,
  );
  assert.match(
    languageRoute,
    /error\.code\s*===\s*"MEDIA_REPLACEMENTS_LIMIT_EXCEEDED"/,
  );
  assert.match(languageRoute, /code:\s*"media_replacements_limit_exceeded"/);
  assert.match(languageRoute, /limit:\s*MAX_RUNTIME_MEDIA_REPLACEMENTS/);
});

test("source-language migration remains locked once locale-specific media mappings exist", () => {
  assert.match(
    generalSettings,
    /database\.projectMediaReplacement\.count\(\{\s*where:\s*\{\s*projectId\s*\}\s*\}\)/,
  );
  assert.match(generalSettings, /mediaReplacements:\s*number/);
  assert.match(projectRoute, /code:\s*"original_language_locked"/);
});
