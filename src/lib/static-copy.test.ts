import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";

import { SITE_LOCALES } from "@/lib/site-locale";
import { uiText } from "@/lib/static-copy";
import { STATIC_MESSAGES } from "@/lib/static-messages";

// The static-message generator (scripts/i18n-generate-static-messages.ts)
// once localized the product name — "Deepglot" -> "Diepglot" (nl),
// "Glotte profonde" (fr), "Profundo" (es) — because the brand was not
// protected before dispatching to the translation provider. The generator
// now stores brand-only messages verbatim and tokenizes embedded brand
// terms; these tests pin that so a future regeneration cannot re-mangle it.
const BRAND_TERMS = ["Deepglot"];

test("keeps the Deepglot brand name untranslated in static copy", () => {
  for (const locale of SITE_LOCALES) {
    assert.equal(uiText(locale, "Deepglot"), "Deepglot", locale);
  }
});

test("no static-message value drops or garbles the Deepglot brand token", () => {
  // Every catalog value that renders the brand must contain the exact token,
  // and no value may be exactly a known mangled form.
  const mangledForms = new Set(["Diepglot", "Glotte profonde", "Profundo"]);

  for (const [locale, entries] of Object.entries(STATIC_MESSAGES)) {
    if (!entries) continue;
    for (const [english, translated] of Object.entries(entries)) {
      for (const brand of BRAND_TERMS) {
        if (english === brand) {
          assert.equal(translated, brand, `${locale}: "${english}"`);
        }
      }
      assert.ok(
        !mangledForms.has(translated.trim()),
        `${locale}: "${english}" -> "${translated}" is a mangled brand form`
      );
    }
  }
});

test("the generator protects brand terms before translation", () => {
  // Guardrail against removing the root-cause fix: the generator must carry a
  // BRAND_TERMS list, short-circuit exact brand messages, and batch only the
  // filtered translatable list. Otherwise the short-circuited "Deepglot" cache
  // value is immediately overwritten by the provider result on regeneration.
  const generator = readFileSync(
    path.join(process.cwd(), "scripts", "i18n-generate-static-messages.ts"),
    "utf8"
  );
  const translateMissing = generator.match(
    /async function translateMissing[\s\S]*?\n}\n\nfunction protectPlaceholders/
  )?.[0];

  assert.match(generator, /const BRAND_TERMS = \[[^\]]*"Deepglot"/);
  assert.match(generator, /isExactBrandTerm/);
  assert.ok(translateMissing, "translateMissing must exist in the generator");
  assert.match(
    translateMissing,
    /for \(let index = 0; index < translatable\.length; index \+= batchSize\)/
  );
  assert.match(translateMissing, /const batch = translatable\.slice\(index, index \+ batchSize\)/);
  assert.doesNotMatch(
    translateMissing,
    /for \(let index = 0; index < missing\.length; index \+= batchSize\)/
  );
});
