import assert from "node:assert/strict";
import test from "node:test";

import {
  MAX_IMPORT_ROWS,
  chunk,
  parseGlossaryCsv,
  parsePoTranslations,
  parseSlugsCsv,
  parseTranslationsCsv,
  sanitizeFilenamePart,
  serializeGlossaryCsv,
  serializePoTranslations,
  serializeSlugsCsv,
  serializeTranslationsCsv,
} from "@/lib/import-export";

test("round-trips translation CSV rows", () => {
  const content = serializeTranslationsCsv([
    {
      originalText: "Hallo",
      translatedText: "Hello",
      langFrom: "de",
      langTo: "en",
      isManual: true,
      source: "IMPORT",
    },
  ]);

  assert.deepEqual(parseTranslationsCsv(content), [
    {
      line: 2,
      originalText: "Hallo",
      translatedText: "Hello",
      langFrom: "de",
      langTo: "en",
      isManual: true,
      source: "IMPORT",
    },
  ]);
});

test("round-trips glossary CSV rows", () => {
  const content = serializeGlossaryCsv([
    {
      originalTerm: "Deepglot",
      translatedTerm: "Deepglot",
      langFrom: "de",
      langTo: "en",
      caseSensitive: true,
    },
  ]);

  assert.deepEqual(parseGlossaryCsv(content), [
    {
      line: 2,
      originalTerm: "Deepglot",
      translatedTerm: "Deepglot",
      langFrom: "de",
      langTo: "en",
      caseSensitive: true,
    },
  ]);
});

test("round-trips slug CSV rows", () => {
  const content = serializeSlugsCsv([
    {
      originalSlug: "preise",
      translatedSlug: "pricing",
      langTo: "en",
      urlCount: 4,
    },
  ]);

  assert.deepEqual(parseSlugsCsv(content), [
    {
      line: 2,
      originalSlug: "preise",
      translatedSlug: "pricing",
      langTo: "en",
      urlCount: 4,
    },
  ]);
});

test("serializes and parses PO translations", () => {
  const po = serializePoTranslations(
    [
      {
        originalText: "Willkommen",
        translatedText: "Welcome",
      },
    ],
    { langFrom: "de", langTo: "en" }
  );

  assert.deepEqual(parsePoTranslations(po), [
    {
      originalText: "Willkommen",
      translatedText: "Welcome",
    },
  ]);
});

test("rejects unexpected CSV headers", () => {
  assert.throws(
    () => parseTranslationsCsv("foo,bar\n1,2"),
    /Invalid CSV headers/
  );
});

test("guards spreadsheet formula leads on export and round-trips on import", () => {
  const csv = serializeTranslationsCsv([
    {
      originalText: "=1+1",
      translatedText: "@SUM(A1)",
      langFrom: "de",
      langTo: "en",
      isManual: true,
      source: "IMPORT",
    },
  ]);

  // No exported cell may begin with a bare formula-lead character.
  const dataLine = csv.split("\n")[1];
  assert.ok(
    dataLine.startsWith("'=1+1"),
    `expected formula-guarded first cell, got: ${dataLine}`
  );
  assert.ok(!/(^|,)[=+@]/.test(dataLine), "no cell may start with = + or @");

  // Deepglot's own files must still round-trip losslessly.
  assert.deepEqual(parseTranslationsCsv(csv), [
    {
      line: 2,
      originalText: "=1+1",
      translatedText: "@SUM(A1)",
      langFrom: "de",
      langTo: "en",
      isManual: true,
      source: "IMPORT",
    },
  ]);
});

test("does not strip a leading apostrophe from ordinary text", () => {
  const csv = serializeTranslationsCsv([
    {
      originalText: "'hello",
      translatedText: "'welt",
      langFrom: "de",
      langTo: "en",
      isManual: false,
      source: "IMPORT",
    },
  ]);

  const parsed = parseTranslationsCsv(csv);
  assert.equal(parsed[0].originalText, "'hello");
  assert.equal(parsed[0].translatedText, "'welt");
});

test("chunk splits a list into fixed-size groups", () => {
  assert.deepEqual(chunk([1, 2, 3, 4, 5], 2), [[1, 2], [3, 4], [5]]);
  assert.deepEqual(chunk([], 3), []);
  assert.throws(() => chunk([1], 0));
});

test("sanitizeFilenamePart removes header-injection characters", () => {
  assert.equal(sanitizeFilenamePart("en"), "en");
  assert.equal(sanitizeFilenamePart('en"; filename="evil'), "enfilenameevil");
  assert.equal(sanitizeFilenamePart("a\r\nb"), "ab");
});

test("MAX_IMPORT_ROWS is a sane positive bound", () => {
  assert.ok(Number.isInteger(MAX_IMPORT_ROWS) && MAX_IMPORT_ROWS > 0);
});
