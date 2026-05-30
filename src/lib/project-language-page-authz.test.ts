import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";

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

test("translations language page hides language mutation controls from non-managers", () => {
  const source = readFileSync(LANGUAGE_PAGE, "utf8");

  assert.match(
    source,
    /canManageProject\(access\)/,
    "the language page must compute project-management access before showing mutation controls"
  );
  assert.match(
    source,
    /canManageLanguages\s*&&\s*\(\s*<div[^>]*>[\s\S]*<AddLanguageDialog/,
    "AddLanguageDialog must only render for project managers because the API gates language writes"
  );
});
