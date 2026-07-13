import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";

const routePath = path.join(
  process.cwd(),
  "src/app/api/projects/[projektId]/translation-memory/route.ts"
);
const componentPath = path.join(
  process.cwd(),
  "src/components/projekte/translation-memory-toggle.tsx"
);

test("translation-memory settings have a management-gated API", () => {
  assert.ok(existsSync(routePath), "settings route is missing");
  const route = readFileSync(routePath, "utf8");
  assert.match(route, /userCanManageProject/);
  assert.match(route, /planSupportsTranslationMemory/);
  assert.match(route, /translationMemory: parsed\.data\.enabled/);
});

test("project settings render an interactive persisted translation-memory toggle", () => {
  assert.ok(existsSync(componentPath), "interactive toggle is missing");
  const component = readFileSync(componentPath, "utf8");
  const page = readFileSync(
    path.join(
      process.cwd(),
      "src/app/(dashboard)/projekte/[projektId]/einstellungen/page.tsx"
    ),
    "utf8"
  );

  assert.match(component, /role="switch"/);
  assert.match(component, /\/translation-memory/);
  assert.match(component, /Speichern fehlgeschlagen/);
  assert.match(page, /<TranslationMemoryToggle/);
});
