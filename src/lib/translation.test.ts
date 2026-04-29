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
      TRANSLATION_PROVIDER: "openrouter",
      OPENAI_API_KEY: "openai-key",
      DEEPL_API_KEY: "deepl-key",
    }),
    "openrouter"
  );
});

test("auto-selects OpenAI before OpenRouter and DeepL when no provider is configured", () => {
  assert.equal(
    resolveTranslationProvider({
      OPENAI_API_KEY: "openai-key",
      OPENROUTER_API_KEY: "openrouter-key",
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
        "Unknown TRANSLATION_PROVIDER 'foobar'. Allowed providers: openai, openrouter, ollama, openai-compatible, deepl, mock.",
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

test("uses project provider settings when translating even if the environment provider differs", async () => {
  const result = await translateTexts(
    {
      texts: ["Hello world"],
      sourceLang: "en",
      targetLang: "de",
    },
    {
      TRANSLATION_PROVIDER: "openai",
      OPENAI_API_KEY: "workspace-openai-key",
    },
    {
      translationProvider: "mock",
    }
  );

  assert.deepEqual(result, [
    { detectedSourceLanguage: "EN", text: "[de] Hello world" },
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
      message: "OpenAI API key is not configured.",
    }
  );
});
