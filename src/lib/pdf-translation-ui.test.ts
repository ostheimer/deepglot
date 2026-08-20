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

test("PDF UI explains that permanent velocity oversize must be split", () => {
  assert.match(panelSource, /velocity_request_too_large/);
  assert.match(panelSource, /Split the PDF into smaller files/);
  assert.match(panelSource, /Teile die PDF-Datei in kleinere Dateien/);
});

test("PDF UI localizes the count-mismatch recovery deadline", () => {
  assert.match(panelSource, /translation_count_mismatch_deadline/);
  assert.match(
    panelSource,
    /The translation could not finish within the request time limit\. Try again\./,
  );
  assert.match(
    panelSource,
    /Die Übersetzung konnte nicht innerhalb des Zeitlimits abgeschlossen werden\. Versuche es erneut\./,
  );
});
