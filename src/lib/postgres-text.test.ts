import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";

import {
  assertPostgresJsonText,
  countPostgresNul,
  inspectPostgresText,
  PostgresTextBoundaryError,
  reportPostgresTextRejection,
} from "@/lib/postgres-text";

test("rejects only U+0000 and preserves valid Unicode and other controls", () => {
  const valid = "Ärger 😀 e\u0301\t\n\r\b\f\u001b";

  assert.equal(countPostgresNul(valid), 0);
  assert.equal(
    inspectPostgresText(valid, { boundary: "test", field: "text" }),
    null,
  );
  assert.equal(countPostgresNul("\u0000a\u0000"), 2);

  const error = inspectPostgresText("private-before\u0000private-after", {
    boundary: "api_input",
    field: "words.0.w",
    index: 0,
  });
  assert.ok(error instanceof PostgresTextBoundaryError);
  assert.equal(error.event.nulCount, 1);
});

test("structured observability never retains rejected text", () => {
  const privateText = "do-not-log\u0000this";
  const error = inspectPostgresText(privateText, {
    boundary: "provider_output",
    field: "text",
    index: 3,
    provider: "openai",
  });
  assert.ok(error);

  const entries: string[] = [];
  reportPostgresTextRejection(error, (message) => entries.push(message));

  assert.equal(entries.length, 1);
  assert.deepEqual(JSON.parse(entries[0]), {
    level: "warn",
    message: "PostgreSQL-incompatible U+0000 rejected.",
    event: "postgres_text_nul_rejected",
    boundary: "provider_output",
    field: "text",
    nulCount: 1,
    index: 3,
    provider: "openai",
  });
  assert.doesNotMatch(JSON.stringify(entries), /do-not-log|this/);
  assert.doesNotMatch(error.message, /do-not-log|this/);
});

test("jsonb defense detects nested NUL without exposing the payload", () => {
  const originalWarn = console.warn;
  const warnings: unknown[][] = [];
  console.warn = (...args) => warnings.push(args);

  try {
    assert.throws(
      () =>
        assertPostgresJsonText(
          { translation: { text: "private\u0000payload" } },
          { boundary: "webhook_event_persistence", field: "payload" },
        ),
      PostgresTextBoundaryError,
    );
  } finally {
    console.warn = originalWarn;
  }

  assert.equal(warnings.length, 1);
  assert.doesNotMatch(JSON.stringify(warnings), /private/);
});

test("translation, batch, import, manual, and event writes keep the persistence guard", () => {
  const source = (file: string) =>
    readFileSync(path.join(process.cwd(), file), "utf8");

  for (const file of [
    "src/app/api/translate/route.ts",
    "src/app/api/projects/[projektId]/manual-translations/route.ts",
    "src/app/api/projects/[projektId]/import/route.ts",
    "src/lib/project-translation-import.ts",
    "src/lib/translation-batches.ts",
  ]) {
    assert.match(source(file), /assertPostgresTextFields\(/, file);
  }
  assert.match(
    source("src/lib/project-webhook-delivery.ts"),
    /assertPostgresJsonText\(/,
  );
});
