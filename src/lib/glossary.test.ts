import assert from "node:assert/strict";
import test from "node:test";

import {
  buildGlossaryProtection,
  hasGlossaryProtection,
  restoreGlossaryTerms,
} from "@/lib/glossary";

test("protects glossary terms and restores configured replacements", () => {
  const protection = buildGlossaryProtection("Hallo Deepglot Team", [
    {
      originalTerm: "Deepglot",
      translatedTerm: "Deepglot",
      caseSensitive: true,
    },
  ]);

  assert.equal(hasGlossaryProtection(protection), true);
  assert.match(protection.protectedText, /__DEEPGLOT_GLOSSARY_0__/);
  assert.equal(
    restoreGlossaryTerms(
      `[en] ${protection.protectedText}`,
      protection
    ),
    "[en] Hallo Deepglot Team"
  );
});

test("matches case-insensitive glossary rules without inflecting output", () => {
  const protection = buildGlossaryProtection("deepglot und DeepGlot", [
    {
      originalTerm: "Deepglot",
      translatedTerm: "Deepglot",
      caseSensitive: false,
    },
  ]);

  assert.equal(
    restoreGlossaryTerms(protection.protectedText, protection),
    "Deepglot und Deepglot"
  );
});

test("prefers longer glossary rules over shorter overlapping terms", () => {
  const protection = buildGlossaryProtection("Deepglot Cloud", [
    {
      originalTerm: "Deepglot",
      translatedTerm: "Deepglot",
      caseSensitive: true,
    },
    {
      originalTerm: "Deepglot Cloud",
      translatedTerm: "Deepglot Cloud",
      caseSensitive: true,
    },
  ]);

  assert.equal(protection.replacements.length, 1);
  assert.equal(
    restoreGlossaryTerms(protection.protectedText, protection),
    "Deepglot Cloud"
  );
});
