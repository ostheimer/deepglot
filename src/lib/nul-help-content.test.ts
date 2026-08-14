import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";

const HELP_PAGE = path.join(
  process.cwd(),
  "src/components/marketing/help-page.tsx"
);
const README = path.join(process.cwd(), "README.md");
const OPERATIONS = path.join(process.cwd(), "OPERATIONS.md");
const POSTGRES_TEXT = path.join(process.cwd(), "src/lib/postgres-text.ts");

test("bilingual help explains the NUL rejection and provider fallback boundary", () => {
  const help = readFileSync(HELP_PAGE, "utf8");

  assert.match(help, /U\+0000/);
  assert.match(help, /null byte/i);
  assert.match(help, /NUL-Zeichen/);
  assert.match(help, /fallback provider/i);
  assert.match(help, /Ersatzanbieter/);
  assert.match(
    help,
    /vor Anbieteraufrufen und vor der Persistenz von Übersetzungsinhalten/,
  );
  assert.match(
    help,
    /before provider calls and before translation content is persisted/,
  );
  assert.match(help, /ohne Versuch, Übersetzungsinhalte zu persistieren/);
  assert.match(help, /without attempting translation-content persistence/);
  assert.doesNotMatch(
    help,
    /Datenbankarbeit|database work|Datenbankschreibversuch|database write attempt/,
  );
});

test("documentation and source limit the guarantee to translation persistence", () => {
  const readme = readFileSync(README, "utf8");
  const operations = readFileSync(OPERATIONS, "utf8");
  const source = readFileSync(POSTGRES_TEXT, "utf8");

  assert.match(readme, /before provider calls or translation-content persistence/);
  assert.match(
    operations,
    /before provider translation or translation-content persistence/,
  );
  assert.doesNotMatch(operations, /before provider or persistence work/);
  assert.match(
    source,
    /before provider translation and\s+\* translation-domain persistence/,
  );
  assert.doesNotMatch(source, /before any provider or database work/);
});
