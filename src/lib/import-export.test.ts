import assert from "node:assert/strict";
import test from "node:test";

import {
  parseGlossaryCsv,
  parsePoTranslations,
  parseSlugsCsv,
  parseTranslationsCsv,
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
