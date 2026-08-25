import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { shouldCreateFreshTranslations } from "@/lib/automatic-translation";

test("automatic translation serves cache-only for bots and explicitly disabled projects", () => {
  assert.equal(
    shouldCreateFreshTranslations({ isBot: false, automaticTranslation: true }),
    true,
  );
  assert.equal(
    shouldCreateFreshTranslations({ isBot: true, automaticTranslation: true }),
    false,
  );
  assert.equal(
    shouldCreateFreshTranslations({ isBot: false, automaticTranslation: false }),
    false,
  );
  assert.equal(
    shouldCreateFreshTranslations({ isBot: false, automaticTranslation: null }),
    true,
  );
});

test("the translation endpoint enforces the project source language and fresh-translation gate", () => {
  const source = readFileSync(
    "src/app/api/translate/route.ts",
    "utf8",
  );

  assert.match(source, /shouldCreateFreshTranslations\(/);
  assert.match(source, /project\.originalLang/);
  assert.match(source, /l_from[\s\S]{0,500}original language/i);
  assert.match(
    source,
    /cache_only:\s*!canCreateFreshTranslations/,
    "cache-only responses must be explicit so clients cannot cache identity misses",
  );
  assert.match(
    source,
    /project\.languages\s*\.filter\(\(language\) => language\.isActive\)/,
    "inactive target languages must not remain translatable",
  );
});
