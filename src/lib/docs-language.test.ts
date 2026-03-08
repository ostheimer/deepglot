import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import {
  checkMarkdownDocumentation,
  collectMarkdownFiles,
  scanMarkdownForNonEnglish,
} from "@/lib/docs-language";

test("detects German prose in markdown text", () => {
  const issues = scanMarkdownForNonEnglish(`
# Heading

Diese Dokumentation enthaelt deutsche Sprache.
`);

  assert.equal(issues.length, 1);
  assert.equal(issues[0].line, 4);
  assert.match(issues[0].context, /deutsche Sprache/i);
});

test("ignores inline code and fenced code blocks", () => {
  const issues = scanMarkdownForNonEnglish(`
Use the route \`/de/preise\` for the localized page.

\`\`\`md
Diese Dokumentation enthaelt deutsche Sprache.
\`\`\`

The rest of this document is written in English.
`);

  assert.equal(issues.length, 0);
});

test("collects markdown files and skips ignored directories", () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "deepglot-docs-language-"));

  fs.writeFileSync(path.join(tempDir, "README.md"), "# Root doc\n", "utf8");
  fs.mkdirSync(path.join(tempDir, "docs"));
  fs.writeFileSync(path.join(tempDir, "docs", "guide.md"), "# Guide\n", "utf8");
  fs.mkdirSync(path.join(tempDir, "node_modules"));
  fs.writeFileSync(path.join(tempDir, "node_modules", "ignored.md"), "# Ignored\n", "utf8");

  const files = collectMarkdownFiles(tempDir).map((filePath) => path.relative(tempDir, filePath));

  assert.deepEqual(files, [path.join("docs", "guide.md"), "README.md"]);
});

test("reports file paths for markdown documentation issues", () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "deepglot-docs-report-"));
  const markdownPath = path.join(tempDir, "notes.md");

  fs.writeFileSync(markdownPath, "Diese Dokumentation ist nicht Englisch.\n", "utf8");

  const report = checkMarkdownDocumentation(tempDir);

  assert.equal(report.files.length, 1);
  assert.equal(report.issues.length, 1);
  assert.equal(report.issues[0].filePath, markdownPath);
  assert.equal(report.issues[0].line, 1);
});
