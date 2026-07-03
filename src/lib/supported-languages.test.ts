import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";

import { EU_LANGUAGE_CODES, getLanguageName } from "@/lib/language-names";
import {
  SHARED_PROVIDER_LANGUAGE_CODES,
  SUPPORTED_TRANSLATION_LANGUAGES,
  SUPPORTED_TRANSLATION_LANGUAGE_CODES,
  isSupportedTranslationPair,
} from "@/lib/supported-languages";

// Canonical supported-language list (#123): both counts are pinned so any
// widening/narrowing is a conscious decision. Marketing and docs claims
// reference exactly these constants: 33 languages offered by the product
// (default LLM providers serve them all), of which 30 are guaranteed on
// every configurable provider including the narrowest (DeepL-class).
// Widening the shared tier requires checking the WEAKEST provider, not just
// the default one.
const PINNED_TOTAL_LANGUAGE_COUNT = 33;
const PINNED_SHARED_PROVIDER_COUNT = 30;

test("pins the canonical supported-language counts (#123)", () => {
  assert.equal(SUPPORTED_TRANSLATION_LANGUAGES.length, PINNED_TOTAL_LANGUAGE_COUNT);
  assert.equal(SUPPORTED_TRANSLATION_LANGUAGE_CODES.size, PINNED_TOTAL_LANGUAGE_COUNT);
  assert.equal(SHARED_PROVIDER_LANGUAGE_CODES.size, PINNED_SHARED_PROVIDER_COUNT);

  // The shared tier is a strict subset of the offered set.
  for (const code of SHARED_PROVIDER_LANGUAGE_CODES) {
    assert.ok(SUPPORTED_TRANSLATION_LANGUAGE_CODES.has(code));
  }
});

test("every canonical entry is well-formed and resolvable via Intl", () => {
  for (const language of SUPPORTED_TRANSLATION_LANGUAGES) {
    assert.match(language.code, /^[a-z]{2}$/, `code ${language.code}`);
    assert.ok(language.english_name.length > 1, `english_name for ${language.code}`);
    assert.ok(language.local_name.length > 0, `local_name for ${language.code}`);

    // language-names.ts must be able to render a display name for every
    // supported code (falls back to the upper-cased code on failure).
    const displayName = getLanguageName(language.code, "en");
    assert.notEqual(
      displayName,
      language.code.toUpperCase(),
      `Intl.DisplayNames must resolve ${language.code}`
    );
  }
});

test("the curated EU picker stays within the canonical list", () => {
  for (const code of EU_LANGUAGE_CODES) {
    assert.ok(
      SUPPORTED_TRANSLATION_LANGUAGE_CODES.has(code),
      `EU picker code ${code} must be part of the canonical supported list`
    );
  }
});

test("pair support requires two distinct supported codes", () => {
  assert.equal(isSupportedTranslationPair("de", "en"), true);
  assert.equal(isSupportedTranslationPair("DE", "EN"), true, "case-insensitive");
  assert.equal(isSupportedTranslationPair("de", "de"), false, "same-language pair");
  assert.equal(isSupportedTranslationPair("de", "xx"), false, "unknown target");
  assert.equal(isSupportedTranslationPair("xx", "en"), false, "unknown source");
});

test("the public language routes derive from the canonical module (no local lists)", () => {
  const routes = [
    "src/app/api/public/languages/route.ts",
    "src/app/api/public/languages/is-supported/route.ts",
  ];

  for (const route of routes) {
    const source = readFileSync(path.join(process.cwd(), route), "utf8");

    assert.match(
      source,
      /from "@\/lib\/supported-languages"/,
      `${route} must import the canonical module`
    );
    assert.doesNotMatch(
      source,
      /local_name:|SUPPORTED_CODES\s*=|new Set\(\[\s*"/,
      `${route} must not carry its own language list`
    );
  }
});
