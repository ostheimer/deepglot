import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";

function source(relativePath: string) {
  return readFileSync(path.join(process.cwd(), relativePath), "utf8");
}

function assertGuardPrecedesWrite(
  fileSource: string,
  writeMarker: string,
  message: string,
) {
  const write = fileSource.indexOf(writeMarker);
  const guard = fileSource.lastIndexOf(
    "lockAndValidateProjectLanguageWrite(",
    write,
  );

  assert.notEqual(write, -1, `${message}: expected production write`);
  assert.notEqual(guard, -1, `${message}: expected language-write guard`);
  assert.ok(guard < write, `${message}: guard must run before the write`);
}

test("manual Translation writes lock and freshly validate the source/target pair", () => {
  const route = source(
    "src/app/api/projects/[projektId]/manual-translations/route.ts",
  );

  assertGuardPrecedesWrite(
    route,
    "tx.translation.upsert(",
    "manual translation",
  );
});

test("translation import writers lock and freshly validate every source/target pair", () => {
  const csvImport = source("src/lib/project-translation-import.ts");
  const importRoute = source(
    "src/app/api/projects/[projektId]/import/route.ts",
  );

  assertGuardPrecedesWrite(
    csvImport,
    "tx.translation.upsert(",
    "translation CSV import",
  );
  assertGuardPrecedesWrite(
    importRoute,
    "tx.translation.upsert(",
    "translation PO import",
  );
});

test("GlossaryRule create and import lock and freshly validate their language pairs", () => {
  const glossaryRoute = source(
    "src/app/api/projects/[projektId]/glossary/route.ts",
  );
  const importRoute = source(
    "src/app/api/projects/[projektId]/import/route.ts",
  );

  assertGuardPrecedesWrite(
    glossaryRoute,
    "tx.glossaryRule.create(",
    "glossary create",
  );
  assertGuardPrecedesWrite(
    importRoute,
    "tx.glossaryRule.upsert(",
    "glossary import",
  );

  const operationalScript = source(
    "scripts/glossary-rule-meinhaushalt.ts",
  );
  assert.match(operationalScript, /db\.\$transaction\(/);
  assertGuardPrecedesWrite(
    operationalScript,
    "tx.glossaryRule.create(",
    "operational glossary writer",
  );
});

test("UrlSlug imports lock and freshly validate the target language", () => {
  const importRoute = source(
    "src/app/api/projects/[projektId]/import/route.ts",
  );

  assertGuardPrecedesWrite(importRoute, "tx.urlSlug.upsert(", "slug import");
  const slugWrite = importRoute.indexOf("tx.urlSlug.upsert(");
  const slugGuard = importRoute.lastIndexOf(
    "lockAndValidateProjectLanguageWrite(",
    slugWrite,
  );
  assert.match(
    importRoute.slice(slugGuard, slugWrite),
    /sourceLanguages:\s*\[project\.originalLang\]/,
    "slug identity must also remain bound to the source snapshot used by the import",
  );
});

test("TranslatedUrl cache-hit analytics lock and freshly validate before upsert", () => {
  const translateRoute = source("src/app/api/translate/route.ts");
  const cacheOnlyBranch = translateRoute.slice(
    translateRoute.indexOf("// 8. Fallback for bots or empty untranslated strings."),
  );

  assert.match(cacheOnlyBranch, /db\.\$transaction\(/);
  assertGuardPrecedesWrite(
    cacheOnlyBranch,
    "upsertTranslatedUrlHit({",
    "cache-hit URL analytics",
  );
  assert.match(
    cacheOnlyBranch.slice(
      cacheOnlyBranch.indexOf("upsertTranslatedUrlHit({"),
      cacheOnlyBranch.indexOf("upsertTranslatedUrlHit({") + 500,
    ),
    /tx,/,
  );
});

test("language-scoped invitation and member writers share the Project language guard", () => {
  const inviteRoute = source(
    "src/app/api/projects/[projektId]/members/invite/route.ts",
  );
  const memberRoute = source(
    "src/app/api/projects/[projektId]/members/[memberId]/route.ts",
  );
  const acceptRoute = source(
    "src/app/api/auth/project-invitations/accept/route.ts",
  );

  assertGuardPrecedesWrite(
    inviteRoute,
    "tx.projectInvitation.create(",
    "language-scoped invitation",
  );
  assertGuardPrecedesWrite(
    memberRoute,
    "tx.projectMember.update(",
    "language-scoped member update",
  );
  assertGuardPrecedesWrite(
    acceptRoute,
    "tx.projectMember.create(",
    "invitation acceptance",
  );
});

test("preview test-login seed locks and validates its fixed de target-language writes", () => {
  const testLogin = source("src/lib/test-login.ts");
  assert.match(testLogin, /db\.\$transaction\(/);

  for (const [marker, label] of [
    ["tx.projectMember.upsert(", "test-login member"],
    ["tx.glossaryRule.upsert(", "test-login glossary"],
    ["tx.urlSlug.upsert(", "test-login URL slug"],
    ["tx.translatedUrl.upsert(", "test-login translated URL"],
    ["tx.translation.upsert(", "test-login translation"],
  ] as const) {
    assertGuardPrecedesWrite(testLogin, marker, label);
  }

  const firstSeedWrite = testLogin.indexOf("tx.projectMember.upsert(");
  const guard = testLogin.lastIndexOf(
    "lockAndValidateProjectLanguageWrite(",
    firstSeedWrite,
  );
  assert.match(testLogin.slice(guard, firstSeedWrite), /sourceLanguages:\s*\["de"\]/);
  assert.match(testLogin.slice(guard, firstSeedWrite), /targetLanguages:\s*\["en", "fr"\]/);
});
