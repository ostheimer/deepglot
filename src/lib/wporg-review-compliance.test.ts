import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";

const switcherPage = readFileSync(
  path.join(
    process.cwd(),
    "src/app/(dashboard)/projekte/[projektId]/einstellungen/switcher/page.tsx"
  ),
  "utf8"
);

test("the dashboard does not advertise the removed arbitrary CSS setting", () => {
  assert.doesNotMatch(switcherPage, /switcherCustomCss|switcher-custom-css/);
  assert.doesNotMatch(switcherPage, /Custom CSS|Benutzerdefiniertes CSS/);
});
