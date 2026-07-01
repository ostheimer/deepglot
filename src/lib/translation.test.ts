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
        "Unknown TRANSLATION_PROVIDER 'foobar'. Allowed providers: openai, gemini, openrouter, ollama, openai-compatible, deepl, mock.",
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

test("falls back to a secondary provider when the primary returns a 429 quota error", async () => {
  const originalFetch = globalThis.fetch;
  const recorded: string[] = [];
  let openaiCalls = 0;
  let geminiCalls = 0;

  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = typeof input === "string" ? input : input.toString();
    recorded.push(url);
    if (url.includes("openai.com")) {
      openaiCalls += 1;
      return new Response(
        JSON.stringify({ error: { message: "rate limit exceeded", type: "insufficient_quota" } }),
        { status: 429 }
      );
    }
    if (url.includes("generativelanguage.googleapis.com")) {
      geminiCalls += 1;
      return new Response(
        JSON.stringify({
          candidates: [
            {
              content: {
                parts: [
                  {
                    text: JSON.stringify({
                      translations: [{ text: "fallback-worked", detectedSourceLanguage: "de" }],
                    }),
                  },
                ],
              },
            },
          ],
        })
      );
    }
    throw new Error(`Unexpected fetch url ${url}`);
  }) as typeof fetch;

  try {
    const result = await translateTexts(
      { texts: ["Hallo"], sourceLang: "de", targetLang: "en" },
      {
        TRANSLATION_PROVIDER: "openai",
        OPENAI_API_KEY: "openai-key",
        GEMINI_API_KEY: "gemini-key",
        TRANSLATION_FALLBACK_PROVIDERS: "gemini",
      }
    );

    assert.equal(openaiCalls, 1);
    assert.equal(geminiCalls, 1);
    assert.deepEqual(result, [
      { text: "fallback-worked", detectedSourceLanguage: "de" },
    ]);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("does not retry on auth errors that should surface to the operator", async () => {
  const originalFetch = globalThis.fetch;
  let openaiCalls = 0;
  let geminiCalls = 0;

  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = typeof input === "string" ? input : input.toString();
    if (url.includes("openai.com")) {
      openaiCalls += 1;
      return new Response('{"error":{"message":"Invalid API key"}}', { status: 401 });
    }
    if (url.includes("generativelanguage.googleapis.com")) {
      geminiCalls += 1;
      return new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: '{"translations":[{"text":"x"}]}' }] } }] }));
    }
    throw new Error(`Unexpected fetch url ${url}`);
  }) as typeof fetch;

  try {
    await assert.rejects(
      () =>
        translateTexts(
          { texts: ["Hi"], sourceLang: "en", targetLang: "de" },
          {
            TRANSLATION_PROVIDER: "openai",
            OPENAI_API_KEY: "openai-key",
            GEMINI_API_KEY: "gemini-key",
            TRANSLATION_FALLBACK_PROVIDERS: "gemini",
          }
        ),
      /401/
    );
    assert.equal(openaiCalls, 1);
    assert.equal(geminiCalls, 0, "fallback must not run on auth errors");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("logs the terminal failure at error level with the full chain when every provider fails", async () => {
  const originalFetch = globalThis.fetch;
  const originalWarn = console.warn;
  const originalError = console.error;
  const warnings: string[] = [];
  const errors: string[] = [];
  console.warn = (...args) => {
    warnings.push(args.map((value) => String(value)).join(" "));
  };
  console.error = (...args) => {
    errors.push(args.map((value) => String(value)).join(" "));
  };

  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = typeof input === "string" ? input : input.toString();
    if (url.includes("openai.com")) {
      return new Response(
        JSON.stringify({
          error: { message: "You exceeded your current quota", type: "insufficient_quota" },
        }),
        { status: 429 }
      );
    }
    if (url.includes("generativelanguage.googleapis.com")) {
      return new Response("upstream gateway exploded", { status: 502 });
    }
    throw new Error(`Unexpected fetch url ${url}`);
  }) as typeof fetch;

  try {
    await assert.rejects(
      () =>
        translateTexts(
          { texts: ["Hallo"], sourceLang: "de", targetLang: "en" },
          {
            TRANSLATION_PROVIDER: "openai",
            OPENAI_API_KEY: "openai-key",
            GEMINI_API_KEY: "gemini-key",
            TRANSLATION_FALLBACK_PROVIDERS: "gemini",
          }
        ),
      /Gemini API error 502/
    );

    // The recoverable hop (openai -> gemini) stays a warning, but now carries
    // the full upstream detail instead of a 120-char slice.
    assert.equal(warnings.length, 1);
    assert.match(warnings[0], /provider openai failed; falling back to gemini/);
    assert.match(warnings[0], /chain: openai -> gemini/);
    assert.match(warnings[0], /insufficient_quota/);

    // The terminal failure (what the caller turns into a 5xx) is logged at
    // error level with the failing provider, the attempted chain and the full
    // upstream message — this is the line that was missing during the outage.
    assert.equal(errors.length, 1);
    assert.match(errors[0], /translation failed via gemini \(last provider in chain\)/);
    assert.match(errors[0], /chain: openai -> gemini/);
    assert.match(errors[0], /Gemini API error 502/);
  } finally {
    globalThis.fetch = originalFetch;
    console.warn = originalWarn;
    console.error = originalError;
  }
});
