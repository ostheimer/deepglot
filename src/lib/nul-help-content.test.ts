import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";

const HELP_PAGE = path.join(
  process.cwd(),
  "src/components/marketing/help-page.tsx"
);

test("bilingual help explains the NUL rejection and provider fallback boundary", () => {
  const help = readFileSync(HELP_PAGE, "utf8");

  assert.match(help, /U\+0000/);
  assert.match(help, /null byte/i);
  assert.match(help, /NUL-Zeichen/);
  assert.match(help, /fallback provider/i);
  assert.match(help, /Ersatzanbieter/);
});
