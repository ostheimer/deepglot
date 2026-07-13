import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";

const route = readFileSync(
  path.join(process.cwd(), "src/app/api/translate/route.ts"),
  "utf8"
);

test("translate route consults organization memory only when the project enables it", () => {
  assert.match(route, /project\.settings\?\.translationMemory/);
  assert.match(route, /findOrganizationTranslationMemory/);
  assert.match(route, /organizationId: project\.organizationId/);
  assert.match(route, /targetProjectId: project\.id/);
});

test("translation-memory hits bypass provider spend and count as manual words", () => {
  const memoryLookup = route.indexOf("translationMemoryByHash.get(hash)");
  const pendingPush = route.indexOf("pendingTranslations.push");

  assert.ok(memoryLookup > 0, "memory lookup is missing");
  assert.ok(
    memoryLookup < pendingPush,
    "memory must resolve before a provider translation is queued"
  );
  assert.match(
    route.slice(memoryLookup, pendingPush),
    /manualWords \+= wordCount/
  );
});
