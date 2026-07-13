import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const pageSource = readFileSync(
  "src/app/(dashboard)/projekte/[projektId]/uebersetzungen/pdf/page.tsx",
  "utf8"
);
const panelSource = readFileSync(
  "src/components/projekte/pdf-translation-panel.tsx",
  "utf8"
);
const sidebarSource = readFileSync(
  "src/components/projekte/project-sidebar.tsx",
  "utf8"
);

test("dashboard exposes a project-scoped PDF upload and download flow", () => {
  assert.match(pageSource, /PdfTranslationPanel/);
  assert.match(pageSource, /canAccessProject/);
  assert.match(pageSource, /!access\s*\|\|\s*!canAccessProject\(access\)/);
  assert.match(panelSource, /accept="\.pdf,application\/pdf"/);
  assert.match(panelSource, /htmlFor="pdf-source-file"/);
  assert.match(panelSource, /id="pdf-source-file"/);
  assert.match(panelSource, /"PDF file", "PDF-Datei"/);
  assert.match(panelSource, /\/pdf-translations/);
  assert.match(panelSource, /response\.blob\(\)/);
  assert.match(sidebarSource, /\/translations\/pdf/);
});

test("PDF UI states the bounded text-only and reflow behavior", () => {
  assert.match(panelSource, /4 MiB/);
  assert.match(panelSource, /20 pages/);
  assert.match(panelSource, /text-based PDF/);
  assert.match(panelSource, /does not preserve the original layout/);
  assert.match(panelSource, /monthly word quota/);
  assert.match(panelSource, /Western European/);
});
