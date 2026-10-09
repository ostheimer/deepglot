import assert from "node:assert/strict";
import test from "node:test";

import {
  normalizeTargetLocale,
  targetLocaleFallbacks,
  languageRemovalFingerprint,
} from "./project-language-lifecycle";

test("canonical target locales keep regional variants distinct and reject malformed tags", () => {
  assert.equal(normalizeTargetLocale(" PT_br "), "pt-br");
  assert.equal(normalizeTargetLocale("zh_Hant_TW"), "zh-hant-tw");
  assert.equal(normalizeTargetLocale("en"), "en");
  assert.equal(normalizeTargetLocale("en--US"), null);
  assert.equal(normalizeTargetLocale("x-private"), null);
});

test("variant fallback prefers the exact locale, then its less specific parents", () => {
  assert.deepEqual(targetLocaleFallbacks("zh-hant-tw"), ["zh-hant-tw", "zh-hant", "zh"]);
  assert.deepEqual(targetLocaleFallbacks("pt-br"), ["pt-br", "pt"]);
});

test("removal confirmation binds the exact preview counts and current configuration", () => {
  const preview = { langCode: "en", projectVersion: "2026-10-09T00:00:00.000Z", translations: 4, urls: 2, slugs: 3, usageWords: 10 };
  assert.equal(languageRemovalFingerprint(preview), languageRemovalFingerprint({ ...preview }));
  assert.notEqual(languageRemovalFingerprint(preview), languageRemovalFingerprint({ ...preview, translations: 5 }));
});
