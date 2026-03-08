import test from "node:test";
import assert from "node:assert/strict";

import {
  countWords,
  resolveTranslationProvider,
  translateTexts,
} from "@/lib/translation";

test("counts words for usage tracking", () => {
  assert.equal(countWords("Hallo Welt"), 2);
  assert.equal(countWords("   one   two   three   "), 3);
  assert.equal(countWords(""), 0);
});

test("prefers an explicitly configured translation provider", () => {
  assert.equal(
    resolveTranslationProvider({
      TRANSLATION_PROVIDER: "deepl",
      OPENAI_API_KEY: "openai-key",
      DEEPL_API_KEY: "deepl-key",
    }),
    "deepl"
  );
});

test("auto-selects OpenAI before DeepL when no provider is configured", () => {
  assert.equal(
    resolveTranslationProvider({
      OPENAI_API_KEY: "openai-key",
      DEEPL_API_KEY: "deepl-key",
    }),
    "openai"
  );
});

test("falls back to mock in test mode without provider secrets", () => {
  assert.equal(resolveTranslationProvider({ NODE_ENV: "test" }), "mock");
});

test("rejects unknown translation providers early", () => {
  assert.throws(
    () => resolveTranslationProvider({ TRANSLATION_PROVIDER: "foobar" }),
    {
      message:
        "Unbekannter TRANSLATION_PROVIDER 'foobar'. Erlaubt sind: openai, deepl, mock.",
    }
  );
});

test("mock provider returns visible placeholder translations", async () => {
  const result = await translateTexts(
    {
      texts: ["Hello world", "Checkout"],
      sourceLang: "en",
      targetLang: "de",
    },
    { TRANSLATION_PROVIDER: "mock" }
  );

  assert.deepEqual(result, [
    { detectedSourceLanguage: "EN", text: "[de] Hello world" },
    { detectedSourceLanguage: "EN", text: "[de] Checkout" },
  ]);
});

test("openai provider fails clearly when the API key is missing", async () => {
  await assert.rejects(
    () =>
      translateTexts(
        {
          texts: ["Hello world"],
          sourceLang: "en",
          targetLang: "de",
        },
        { TRANSLATION_PROVIDER: "openai" }
      ),
    {
      message: "OPENAI_API_KEY ist nicht konfiguriert.",
    }
  );
});
