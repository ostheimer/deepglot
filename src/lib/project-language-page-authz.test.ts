import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";

// Guardrail for the translations "Languages" page.
//
// The page itself is in the translator-visible translations area (gated only by
// the project layout), but adding/removing target languages is management-gated
// at the API (see languages/route.ts, covered by project-settings-route-authz).
// The page must mirror that bar in the UI: only project managers may see the
// AddLanguageDialog, otherwise a translator is shown a control whose submit the
// API rejects with a 404.
//
// This is a source-level wiring check (the page is a server component tightly
// coupled to auth + Prisma), matching the style of project-settings-route-authz.
const LANGUAGE_PAGE = path.join(
  process.cwd(),
  "src",
  "app",
  "(dashboard)",
  "projekte",
  "[projektId]",
  "uebersetzungen",
  "sprachen",
  "page.tsx"
);

test("translations language page gates the add-language control on project management", () => {
  const source = readFileSync(LANGUAGE_PAGE, "utf8");

  assert.match(
    source,
    /userCanManageProject\(/,
    "the language page must resolve project-management access before rendering mutation controls"
  );
  assert.match(
    source,
    /canManageLanguages\s*&&\s*\(\s*<div[^>]*>[\s\S]*?<AddLanguageDialog/,
    "AddLanguageDialog must render only for project managers (the API gates language writes)"
  );
});
