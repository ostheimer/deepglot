import test from "node:test";
import assert from "node:assert/strict";

import {
  DEFAULT_PROVIDER_TIMEOUT_MS,
  DEFAULT_TRANSLATION_CHUNK_CONCURRENCY,
  DEFAULT_TRANSLATION_CHUNK_SIZE,
  DEFAULT_TRANSLATION_REQUEST_TIMEOUT_MS,
  countWords,
  resolveProviderTimeoutMs,
  resolveTranslationChunking,
  resolveTranslationProvider,
  resolveTranslationRequestTimeoutMs,
  translateTexts,
} from "@/lib/translation";

function openAIResponse(translations: unknown): Response {
  return new Response(
    JSON.stringify({
      choices: [
        {
          message: {
            content: JSON.stringify({ translations }),
          },
        },
      ],
    })
  );
}

function openAIModelContentResponse(content: string): Response {
  return new Response(
    JSON.stringify({
      choices: [{ message: { content } }],
    })
  );
}

function geminiResponse(translations: unknown): Response {
  return new Response(
    JSON.stringify({
      candidates: [
        {
          content: {
            parts: [
              {
                text: JSON.stringify({ translations }),
              },
            ],
          },
        },
      ],
    })
  );
}

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

test("does not fail over when the primary provider configuration is invalid", async () => {
  const originalFetch = globalThis.fetch;
  let providerCalls = 0;

  globalThis.fetch = (async () => {
    providerCalls += 1;
    throw new Error("No provider request should run for invalid configuration");
  }) as typeof fetch;

  try {
    await assert.rejects(
      () =>
        translateTexts(
          { texts: ["Hallo"], sourceLang: "de", targetLang: "en" },
          {
            TRANSLATION_PROVIDER: "openai",
            GEMINI_API_KEY: "gemini-key",
            TRANSLATION_FALLBACK_PROVIDERS: "gemini",
          }
        ),
      /OpenAI API key is not configured/
    );
    assert.equal(providerCalls, 0, "configuration errors must not reach a fallback provider");
  } finally {
    globalThis.fetch = originalFetch;
  }
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

test("falls back when a provider returns fewer translations than requested", async () => {
  const originalFetch = globalThis.fetch;
  let openaiCalls = 0;
  let geminiCalls = 0;

  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = typeof input === "string" ? input : input.toString();
    if (url.includes("openai.com")) {
      openaiCalls += 1;
      return new Response(
        JSON.stringify({
          choices: [
            {
              message: {
                content: JSON.stringify({
                  translations: [{ text: "only-one-result" }],
                }),
              },
            },
          ],
        })
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
                      translations: [
                        { text: "first-fallback", detectedSourceLanguage: "de" },
                        { text: "second-fallback", detectedSourceLanguage: "de" },
                      ],
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
      {
        texts: ["Erster Text", "Zweiter Text"],
        sourceLang: "de",
        targetLang: "en",
      },
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
      { text: "first-fallback", detectedSourceLanguage: "de" },
      { text: "second-fallback", detectedSourceLanguage: "de" },
    ]);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

/**
 * Production evidence from 2026-08-12 showed a two-text chunk where OpenAI
 * returned one item and the Gemini fallback returned three. Both providers
 * had answered successfully at the transport layer, but the request still
 * ended as HTTP 500 even though each source string could be translated on its
 * own. A contract mismatch on a multi-text chunk should therefore be isolated
 * into bounded smaller requests after the configured provider chain is
 * exhausted, while preserving input order.
 */
test("isolates a terminal provider count mismatch so valid texts can still translate", async () => {
  const originalFetch = globalThis.fetch;
  const originalWarn = console.warn;
  const originalError = console.error;
  let openaiCalls = 0;
  let geminiCalls = 0;

  console.warn = () => {};
  console.error = () => {};
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input.toString();

    if (url.includes("openai.com")) {
      openaiCalls += 1;
      const body = JSON.parse(String(init?.body ?? "{}"));
      const { texts } = JSON.parse(body.messages[1].content) as { texts: string[] };

      if (texts.length > 1) {
        return openAIResponse([{ text: "only-one-result" }]);
      }

      return openAIResponse([{ text: `openai:${texts[0]}` }]);
    }

    if (url.includes("generativelanguage.googleapis.com")) {
      geminiCalls += 1;
      const body = JSON.parse(String(init?.body ?? "{}"));
      const { texts } = JSON.parse(body.contents[0].parts[0].text) as {
        texts: string[];
      };

      return geminiResponse([
        { text: `gemini-extra:${texts[0]}` },
        { text: `gemini-extra:${texts[1]}` },
        { text: "unexpected-third-result" },
      ]);
    }

    throw new Error(`Unexpected fetch url ${url}`);
  }) as typeof fetch;

  try {
    const result = await translateTexts(
      {
        texts: ["Erster Text", "Zweiter Text"],
        sourceLang: "de",
        targetLang: "en",
      },
      {
        TRANSLATION_PROVIDER: "openai",
        OPENAI_API_KEY: "openai-key",
        GEMINI_API_KEY: "gemini-key",
        TRANSLATION_FALLBACK_PROVIDERS: "gemini",
      }
    );

    assert.deepEqual(
      result.map((entry) => entry.text),
      ["openai:Erster Text", "openai:Zweiter Text"]
    );
    assert.equal(openaiCalls, 3, "the failed pair plus two bounded singleton retries");
    assert.equal(geminiCalls, 1, "the fallback is tried once before isolating the pair");
  } finally {
    globalThis.fetch = originalFetch;
    console.warn = originalWarn;
    console.error = originalError;
  }
});

test("keeps a singleton terminal when every provider returns a count mismatch", async () => {
  const originalFetch = globalThis.fetch;
  const originalWarn = console.warn;
  const originalError = console.error;
  let openaiCalls = 0;
  let geminiCalls = 0;

  console.warn = () => {};
  console.error = () => {};
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = typeof input === "string" ? input : input.toString();
    if (url.includes("openai.com")) {
      openaiCalls += 1;
      return openAIResponse([
        { text: "unexpected-first-result" },
        { text: "unexpected-second-result" },
      ]);
    }
    if (url.includes("generativelanguage.googleapis.com")) {
      geminiCalls += 1;
      return geminiResponse([]);
    }
    throw new Error(`Unexpected fetch url ${url}`);
  }) as typeof fetch;

  try {
    await assert.rejects(
      () =>
        translateTexts(
          { texts: ["Ein Text"], sourceLang: "de", targetLang: "en" },
          {
            TRANSLATION_PROVIDER: "openai",
            OPENAI_API_KEY: "openai-key",
            GEMINI_API_KEY: "gemini-key",
            TRANSLATION_FALLBACK_PROVIDERS: "gemini",
          }
        ),
      /Gemini returned 0 instead of 1 translations/
    );
    assert.equal(openaiCalls, 1, "a singleton must not be split or retried");
    assert.equal(geminiCalls, 1, "the configured chain runs only once");
  } finally {
    globalThis.fetch = originalFetch;
    console.warn = originalWarn;
    console.error = originalError;
  }
});

test("caps count mismatch isolation for a large permanently failing chunk", async () => {
  const originalFetch = globalThis.fetch;
  const originalWarn = console.warn;
  const originalError = console.error;
  let providerCalls = 0;

  console.warn = () => {};
  console.error = () => {};
  globalThis.fetch = (async () => {
    providerCalls += 1;
    return openAIResponse([]);
  }) as typeof fetch;

  try {
    await assert.rejects(
      () =>
        translateTexts(
          {
            texts: Array.from({ length: 64 }, (_, index) => `Private ${index}`),
            sourceLang: "de",
            targetLang: "en",
          },
          {
            TRANSLATION_PROVIDER: "openai",
            OPENAI_API_KEY: "openai-key",
            TRANSLATION_CHUNK_SIZE: "64",
          }
        ),
      // Direct isolation reaches a singleton the provider still cannot
      // translate — a genuine failure, not an artifact of the limits.
      /OpenAI hat 0 statt 1 Uebersetzungen geliefert/
    );
    // Parallel singletons race the request-level abort, so the exact count is
    // nondeterministic — but it can never exceed one root call plus one call
    // for each of the 64 isolated texts.
    assert.ok(
      providerCalls >= 2,
      `recovery must attempt the root and at least one singleton, saw ${providerCalls}`
    );
    assert.ok(
      providerCalls <= 65,
      `calls must stay within the 64-text isolation bound of 65, saw ${providerCalls}`
    );
  } finally {
    globalThis.fetch = originalFetch;
    console.warn = originalWarn;
    console.error = originalError;
  }
});

test("bounds provider calls while isolating the default eight-text chunk", async () => {
  const originalFetch = globalThis.fetch;
  const originalWarn = console.warn;
  const originalError = console.error;
  let providerCalls = 0;

  console.warn = () => {};
  console.error = () => {};
  globalThis.fetch = (async (_input: RequestInfo | URL, init?: RequestInit) => {
    providerCalls += 1;
    const body = JSON.parse(String(init?.body ?? "{}"));
    const { texts } = JSON.parse(body.messages[1].content) as { texts: string[] };

    return openAIResponse(
      texts.length === 1 ? [{ text: `translated:${texts[0]}` }] : []
    );
  }) as typeof fetch;

  try {
    const result = await translateTexts(
      {
        texts: Array.from({ length: 8 }, (_, index) => `Segment ${index}`),
        sourceLang: "de",
        targetLang: "en",
      },
      {
        TRANSLATION_PROVIDER: "openai",
        OPENAI_API_KEY: "openai-key",
      }
    );

    // The recoverable case must actually recover — this exact shape produced
    // 28 budget-exhaustion 500s in production under the fixed budget of 6.
    assert.deepEqual(
      result.map((entry) => entry.text),
      Array.from({ length: 8 }, (_, index) => `translated:Segment ${index}`)
    );
    // …and direct singleton isolation avoids redundant intermediate shapes:
    // one failing root plus eight successful singletons.
    assert.equal(
      providerCalls,
      9,
      "a completed isolation must stay at the direct-singleton call bound"
    );
  } finally {
    globalThis.fetch = originalFetch;
    console.warn = originalWarn;
    console.error = originalError;
  }
});

test("caps total provider time below the translate route duration", { timeout: 5_000 }, async () => {
  const originalFetch = globalThis.fetch;
  const originalError = console.error;

  console.error = () => {};
  globalThis.fetch = (async (_input: RequestInfo | URL, init?: RequestInit) => {
    const signal = init?.signal;
    assert.ok(signal, "provider calls require an abort signal");

    return new Promise<Response>((_resolve, reject) => {
      const watchdog = setTimeout(
        () => reject(new Error("the route request deadline was not applied")),
        1_000
      );
      const rejectWithReason = () => {
        clearTimeout(watchdog);
        reject(signal.reason);
      };
      if (signal.aborted) {
        rejectWithReason();
        return;
      }
      signal.addEventListener("abort", rejectWithReason, { once: true });
    });
  }) as typeof fetch;

  try {
    await assert.rejects(
      () =>
        translateTexts(
          { texts: ["Ein Text"], sourceLang: "de", targetLang: "en" },
          {
            TRANSLATION_PROVIDER: "openai",
            OPENAI_API_KEY: "openai-key",
            TRANSLATION_PROVIDER_TIMEOUT_MS: "10000",
            TRANSLATION_REQUEST_TIMEOUT_MS: "30",
          }
        ),
      (error: unknown) =>
        error instanceof Error && error.name === "TimeoutError"
    );
  } finally {
    globalThis.fetch = originalFetch;
    console.error = originalError;
  }
});

test("honors a caller-specific provider-work ceiling below the translate route budget", { timeout: 5_000 }, async () => {
  const originalFetch = globalThis.fetch;
  const originalError = console.error;

  console.error = () => {};
  globalThis.fetch = (async (_input: RequestInfo | URL, init?: RequestInit) => {
    const signal = init?.signal;
    assert.ok(signal, "provider calls require an abort signal");

    return new Promise<Response>((_resolve, reject) => {
      const watchdog = setTimeout(
        () => reject(new Error("the caller-specific request deadline was not applied")),
        1_000
      );
      const rejectWithReason = () => {
        clearTimeout(watchdog);
        reject(signal.reason);
      };
      if (signal.aborted) {
        rejectWithReason();
        return;
      }
      signal.addEventListener("abort", rejectWithReason, { once: true });
    });
  }) as typeof fetch;

  try {
    await assert.rejects(
      () =>
        translateTexts(
          { texts: ["Ein PDF-Text"], sourceLang: "de", targetLang: "en" },
          {
            TRANSLATION_PROVIDER: "openai",
            OPENAI_API_KEY: "openai-key",
            TRANSLATION_PROVIDER_TIMEOUT_MS: "10000",
            TRANSLATION_REQUEST_TIMEOUT_MS: "10000",
          },
          null,
          { maxRequestTimeoutMs: 30 }
        ),
      (error: unknown) =>
        error instanceof Error && error.name === "TimeoutError"
    );
  } finally {
    globalThis.fetch = originalFetch;
    console.error = originalError;
  }
});

test("keeps the lower configured provider-work ceiling when the caller allows longer", { timeout: 5_000 }, async () => {
  const originalFetch = globalThis.fetch;
  const originalError = console.error;

  console.error = () => {};
  // A hanging provider: if the caller's higher ceiling (10s) had replaced the
  // configured 30ms deadline, the watchdog below would fire first and the
  // assertion on the error type would fail.
  globalThis.fetch = (async (_input: RequestInfo | URL, init?: RequestInit) => {
    const signal = init?.signal;
    assert.ok(signal, "provider calls require an abort signal");

    return new Promise<Response>((_resolve, reject) => {
      const watchdog = setTimeout(
        () => reject(new Error("the configured request deadline was not applied")),
        1_000
      );
      const rejectWithReason = () => {
        clearTimeout(watchdog);
        reject(signal.reason);
      };
      if (signal.aborted) {
        rejectWithReason();
        return;
      }
      signal.addEventListener("abort", rejectWithReason, { once: true });
    });
  }) as typeof fetch;

  try {
    await assert.rejects(
      () =>
        translateTexts(
          { texts: ["Ein Text"], sourceLang: "de", targetLang: "en" },
          {
            TRANSLATION_PROVIDER: "openai",
            OPENAI_API_KEY: "openai-key",
            TRANSLATION_PROVIDER_TIMEOUT_MS: "10000",
            TRANSLATION_REQUEST_TIMEOUT_MS: "30",
          },
          null,
          { maxRequestTimeoutMs: 10_000 }
        ),
      (error: unknown) =>
        error instanceof Error && error.name === "TimeoutError"
    );
  } finally {
    globalThis.fetch = originalFetch;
    console.error = originalError;
  }
});

test("does not start provider work after the caller-specific budget has already expired", async () => {
  const originalFetch = globalThis.fetch;
  let providerCalls = 0;

  globalThis.fetch = (async () => {
    providerCalls += 1;
    return openAIResponse([{ text: "must-not-run" }]);
  }) as typeof fetch;

  try {
    await assert.rejects(
      () =>
        translateTexts(
          { texts: ["Ein PDF-Text"], sourceLang: "de", targetLang: "en" },
          {
            TRANSLATION_PROVIDER: "openai",
            OPENAI_API_KEY: "openai-key",
          },
          null,
          {
            maxRequestTimeoutMs: 40_000,
            signal: AbortSignal.abort(
              new DOMException(
                "The operation was aborted due to timeout",
                "TimeoutError"
              )
            ),
          }
        ),
      (error: unknown) =>
        error instanceof Error && error.name === "TimeoutError"
    );
    assert.equal(providerCalls, 0, "an expired PDF budget must fail before HTTP");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("does not isolate an in-flight sibling after another root chunk fails", async () => {
  const originalFetch = globalThis.fetch;
  const originalWarn = console.warn;
  const originalError = console.error;
  const calls: Array<{ group: string; size: number }> = [];

  console.warn = () => {};
  console.error = () => {};
  globalThis.fetch = (async (_input: RequestInfo | URL, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body ?? "{}"));
    const { texts } = JSON.parse(body.messages[1].content) as { texts: string[] };
    const group = texts[0].startsWith("A") ? "A" : "B";
    calls.push({ group, size: texts.length });

    if (group === "B" && texts.length > 1) {
      await new Promise((resolve) => setTimeout(resolve, 25));
    }

    return openAIResponse([]);
  }) as typeof fetch;

  try {
    await assert.rejects(() =>
      translateTexts(
        {
          texts: ["A1", "A2", "B1", "B2"],
          sourceLang: "de",
          targetLang: "en",
        },
        {
          TRANSLATION_PROVIDER: "openai",
          OPENAI_API_KEY: "openai-key",
          TRANSLATION_CHUNK_SIZE: "2",
          TRANSLATION_CHUNK_CONCURRENCY: "2",
        }
      )
    );

    await new Promise((resolve) => setTimeout(resolve, 80));
    assert.equal(
      calls.filter((call) => call.group === "B" && call.size === 1).length,
      0,
      "a sibling still in flight must observe the shared failure before isolating"
    );
  } finally {
    globalThis.fetch = originalFetch;
    console.warn = originalWarn;
    console.error = originalError;
  }
});

test("logs one privacy-safe terminal count mismatch after isolation", async () => {
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
  globalThis.fetch = (async (_input: RequestInfo | URL, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body ?? "{}"));
    const { texts } = JSON.parse(body.messages[1].content) as { texts: string[] };
    return openAIResponse(texts.length > 1 ? [{ text: "too-few" }] : []);
  }) as typeof fetch;

  try {
    await assert.rejects(() =>
      translateTexts(
        {
          texts: [
            "private-alpha",
            "private-beta",
            "private-gamma",
            "private-delta",
          ],
          sourceLang: "de",
          targetLang: "en",
        },
        {
          TRANSLATION_PROVIDER: "openai",
          OPENAI_API_KEY: "openai-key",
        }
      )
    );

    assert.equal(
      warnings.filter((entry) => entry.includes("isolating provider count mismatch"))
        .length,
      1,
      "only the root isolation decision should be logged"
    );
    assert.equal(errors.length, 1, "the terminal isolated failure needs one error log");
    assert.match(errors[0], /OpenAI hat 0 statt 1 Uebersetzungen geliefert/);
    assert.doesNotMatch(
      JSON.stringify({ warnings, errors }),
      /private-alpha|private-beta|private-gamma|private-delta/
    );
  } finally {
    globalThis.fetch = originalFetch;
    console.warn = originalWarn;
    console.error = originalError;
  }
});

test("does not isolate a multi-text chunk when the exhausted chain includes a malformed response", async () => {
  const originalFetch = globalThis.fetch;
  const originalWarn = console.warn;
  const originalError = console.error;
  let openaiCalls = 0;
  let geminiCalls = 0;

  console.warn = () => {};
  console.error = () => {};
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = typeof input === "string" ? input : input.toString();
    if (url.includes("openai.com")) {
      openaiCalls += 1;
      return openAIResponse([{ text: "only-one-result" }]);
    }
    if (url.includes("generativelanguage.googleapis.com")) {
      geminiCalls += 1;
      return new Response(
        JSON.stringify({ promptFeedback: { blockReason: "SAFETY" } })
      );
    }
    throw new Error(`Unexpected fetch url ${url}`);
  }) as typeof fetch;

  try {
    await assert.rejects(
      () =>
        translateTexts(
          {
            texts: ["Erster Text", "Zweiter Text"],
            sourceLang: "de",
            targetLang: "en",
          },
          {
            TRANSLATION_PROVIDER: "openai",
            OPENAI_API_KEY: "openai-key",
            GEMINI_API_KEY: "gemini-key",
            TRANSLATION_FALLBACK_PROVIDERS: "gemini",
          }
        ),
      /Gemini blocked the translation prompt/
    );
    assert.equal(openaiCalls, 1, "count mismatch must not hide another response error");
    assert.equal(geminiCalls, 1, "a malformed response must not trigger isolation");
  } finally {
    globalThis.fetch = originalFetch;
    console.warn = originalWarn;
    console.error = originalError;
  }
});

test("does not isolate when an earlier provider failure was not a count mismatch", async (t) => {
  const scenarios: Array<{ name: string; primaryResponse: () => Response }> = [
    {
      name: "timeout",
      primaryResponse: () => {
        throw Object.assign(new Error("provider timed out"), {
          name: "TimeoutError",
        });
      },
    },
    {
      name: "quota response",
      primaryResponse: () =>
        new Response(
          JSON.stringify({
            error: {
              message: "rate limit exceeded",
              type: "insufficient_quota",
            },
          }),
          { status: 429 }
        ),
    },
    {
      name: "NUL output",
      primaryResponse: () =>
        openAIResponse([
          { text: "private-before\u0000private-after" },
          { text: "otherwise-valid" },
        ]),
    },
  ];

  for (const scenario of scenarios) {
    await t.test(scenario.name, async () => {
      const originalFetch = globalThis.fetch;
      const originalWarn = console.warn;
      const originalError = console.error;
      let openaiCalls = 0;
      let geminiCalls = 0;

      console.warn = () => {};
      console.error = () => {};
      globalThis.fetch = (async (input: RequestInfo | URL) => {
        const url = typeof input === "string" ? input : input.toString();
        if (url.includes("openai.com")) {
          openaiCalls += 1;
          return scenario.primaryResponse();
        }
        if (url.includes("generativelanguage.googleapis.com")) {
          geminiCalls += 1;
          return geminiResponse([{ text: "only-one-result" }]);
        }
        throw new Error(`Unexpected fetch url ${url}`);
      }) as typeof fetch;

      try {
        await assert.rejects(
          () =>
            translateTexts(
              {
                texts: ["Erster Text", "Zweiter Text"],
                sourceLang: "de",
                targetLang: "en",
              },
              {
                TRANSLATION_PROVIDER: "openai",
                OPENAI_API_KEY: "openai-key",
                GEMINI_API_KEY: "gemini-key",
                TRANSLATION_FALLBACK_PROVIDERS: "gemini",
              }
            ),
          /Gemini returned 1 instead of 2 translations/
        );
        assert.equal(
          openaiCalls,
          1,
          `${scenario.name} must not be retried through isolation`
        );
        assert.equal(
          geminiCalls,
          1,
          "the terminal count mismatch remains terminal"
        );
      } finally {
        globalThis.fetch = originalFetch;
        console.warn = originalWarn;
        console.error = originalError;
      }
    });
  }
});

test("falls back when a provider returns a JSON null envelope", async () => {
  const originalFetch = globalThis.fetch;
  let openaiCalls = 0;
  let geminiCalls = 0;

  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = typeof input === "string" ? input : input.toString();
    if (url.includes("openai.com")) {
      openaiCalls += 1;
      return new Response("null", {
        headers: { "content-type": "application/json" },
      });
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
                      translations: [
                        { text: "fallback-after-null", detectedSourceLanguage: "de" },
                      ],
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
      { text: "fallback-after-null", detectedSourceLanguage: "de" },
    ]);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("falls back for native fetch transport errors", async (t) => {
  const cases: Array<{ name: string; error: Error }> = [
    {
      name: "Undici cause code",
      error: Object.assign(new TypeError("request transport failed"), {
        cause: { code: "UND_ERR_CONNECT_TIMEOUT" },
      }),
    },
    {
      name: "timeout error",
      error: Object.assign(new Error("The operation was aborted due to timeout"), {
        name: "TimeoutError",
      }),
    },
    {
      name: "abort error",
      error: Object.assign(new Error("This operation was aborted"), {
        name: "AbortError",
      }),
    },
  ];

  for (const scenario of cases) {
    await t.test(scenario.name, async () => {
      const originalFetch = globalThis.fetch;
      let openaiCalls = 0;
      let geminiCalls = 0;

      globalThis.fetch = (async (input: RequestInfo | URL) => {
        const url = typeof input === "string" ? input : input.toString();
        if (url.includes("openai.com")) {
          openaiCalls += 1;
          throw scenario.error;
        }
        if (url.includes("generativelanguage.googleapis.com")) {
          geminiCalls += 1;
          return geminiResponse([{ text: "transport-fallback" }]);
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
        assert.deepEqual(result, [{ text: "transport-fallback" }]);
      } finally {
        globalThis.fetch = originalFetch;
      }
    });
  }
});

test("falls back when OpenAI model content is JSON null", async () => {
  const originalFetch = globalThis.fetch;
  let openaiCalls = 0;
  let geminiCalls = 0;

  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = typeof input === "string" ? input : input.toString();
    if (url.includes("openai.com")) {
      openaiCalls += 1;
      return openAIModelContentResponse("null");
    }
    if (url.includes("generativelanguage.googleapis.com")) {
      geminiCalls += 1;
      return geminiResponse([{ text: "fallback-after-inner-null" }]);
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
    assert.deepEqual(result, [{ text: "fallback-after-inner-null" }]);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("falls back when Gemini returns non-array candidate parts", async () => {
  const originalFetch = globalThis.fetch;
  let geminiCalls = 0;
  let openaiCalls = 0;

  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = typeof input === "string" ? input : input.toString();
    if (url.includes("generativelanguage.googleapis.com")) {
      geminiCalls += 1;
      return new Response(
        JSON.stringify({
          candidates: [{ content: { parts: { text: "not-an-array" } } }],
        })
      );
    }
    if (url.includes("openai.com")) {
      openaiCalls += 1;
      return openAIResponse([{ text: "fallback-after-bad-parts" }]);
    }
    throw new Error(`Unexpected fetch url ${url}`);
  }) as typeof fetch;

  try {
    const result = await translateTexts(
      { texts: ["Hallo"], sourceLang: "de", targetLang: "en" },
      {
        TRANSLATION_PROVIDER: "gemini",
        GEMINI_API_KEY: "gemini-key",
        OPENAI_API_KEY: "openai-key",
        TRANSLATION_FALLBACK_PROVIDERS: "openai",
      }
    );

    assert.equal(geminiCalls, 1);
    assert.equal(openaiCalls, 1);
    assert.deepEqual(result, [
      {
        detectedSourceLanguage: undefined,
        text: "fallback-after-bad-parts",
      },
    ]);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("falls back when Gemini blocks the translation prompt", async () => {
  const originalFetch = globalThis.fetch;
  let geminiCalls = 0;
  let openaiCalls = 0;

  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = typeof input === "string" ? input : input.toString();
    if (url.includes("generativelanguage.googleapis.com")) {
      geminiCalls += 1;
      return new Response(
        JSON.stringify({ promptFeedback: { blockReason: "SAFETY" } })
      );
    }
    if (url.includes("openai.com")) {
      openaiCalls += 1;
      return openAIResponse([{ text: "fallback-after-prompt-block" }]);
    }
    throw new Error(`Unexpected fetch url ${url}`);
  }) as typeof fetch;

  try {
    const result = await translateTexts(
      { texts: ["Hallo"], sourceLang: "de", targetLang: "en" },
      {
        TRANSLATION_PROVIDER: "gemini",
        GEMINI_API_KEY: "gemini-key",
        OPENAI_API_KEY: "openai-key",
        TRANSLATION_FALLBACK_PROVIDERS: "openai",
      }
    );

    assert.equal(geminiCalls, 1);
    assert.equal(openaiCalls, 1);
    assert.equal(result[0]?.text, "fallback-after-prompt-block");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("falls back when a provider returns HTTP 408", async () => {
  const originalFetch = globalThis.fetch;
  let openaiCalls = 0;
  let geminiCalls = 0;

  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = typeof input === "string" ? input : input.toString();
    if (url.includes("openai.com")) {
      openaiCalls += 1;
      return new Response("request timeout", { status: 408 });
    }
    if (url.includes("generativelanguage.googleapis.com")) {
      geminiCalls += 1;
      return geminiResponse([{ text: "fallback-after-http-408" }]);
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
    assert.deepEqual(result, [{ text: "fallback-after-http-408" }]);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("falls back from whitespace-only OpenAI translations", async () => {
  const originalFetch = globalThis.fetch;
  let openaiCalls = 0;
  let geminiCalls = 0;

  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = typeof input === "string" ? input : input.toString();
    if (url.includes("openai.com")) {
      openaiCalls += 1;
      return openAIResponse([{ text: " \t " }]);
    }
    if (url.includes("generativelanguage.googleapis.com")) {
      geminiCalls += 1;
      return geminiResponse([{ text: "openai-whitespace-fallback" }]);
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
    assert.deepEqual(result, [{ text: "openai-whitespace-fallback" }]);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("falls back from whitespace-only Gemini translations", async () => {
  const originalFetch = globalThis.fetch;
  let geminiCalls = 0;
  let openaiCalls = 0;

  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = typeof input === "string" ? input : input.toString();
    if (url.includes("generativelanguage.googleapis.com")) {
      geminiCalls += 1;
      return geminiResponse([{ text: " \t " }]);
    }
    if (url.includes("openai.com")) {
      openaiCalls += 1;
      return openAIResponse([{ text: "gemini-whitespace-fallback" }]);
    }
    throw new Error(`Unexpected fetch url ${url}`);
  }) as typeof fetch;

  try {
    const result = await translateTexts(
      { texts: ["Hallo"], sourceLang: "de", targetLang: "en" },
      {
        TRANSLATION_PROVIDER: "gemini",
        GEMINI_API_KEY: "gemini-key",
        OPENAI_API_KEY: "openai-key",
        TRANSLATION_FALLBACK_PROVIDERS: "openai",
      }
    );

    assert.equal(geminiCalls, 1);
    assert.equal(openaiCalls, 1);
    assert.deepEqual(result, [
      {
        detectedSourceLanguage: undefined,
        text: "gemini-whitespace-fallback",
      },
    ]);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("rejects NUL provider output and falls back without logging translation text", async () => {
  const originalFetch = globalThis.fetch;
  const originalWarn = console.warn;
  const warnings: unknown[][] = [];
  console.warn = (...args) => warnings.push(args);
  let openaiCalls = 0;
  let geminiCalls = 0;

  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = typeof input === "string" ? input : input.toString();
    if (url.includes("openai.com")) {
      openaiCalls += 1;
      return openAIResponse([{ text: "private-before\u0000private-after" }]);
    }
    if (url.includes("generativelanguage.googleapis.com")) {
      geminiCalls += 1;
      return geminiResponse([{ text: "safe-fallback" }]);
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
      },
    );

    assert.equal(openaiCalls, 1);
    assert.equal(geminiCalls, 1);
    assert.deepEqual(result, [{ text: "safe-fallback" }]);
    const serializedWarnings = JSON.stringify(warnings);
    assert.match(serializedWarnings, /postgres_text_nul_rejected/);
    assert.match(serializedWarnings, /translation_provider_output/);
    assert.doesNotMatch(serializedWarnings, /private-before|private-after/);
  } finally {
    globalThis.fetch = originalFetch;
    console.warn = originalWarn;
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
          { texts: ["Hi", "There"], sourceLang: "en", targetLang: "de" },
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

test("resolves chunking defaults and honours environment overrides", () => {
  assert.deepEqual(resolveTranslationChunking({}), {
    size: DEFAULT_TRANSLATION_CHUNK_SIZE,
    concurrency: DEFAULT_TRANSLATION_CHUNK_CONCURRENCY,
  });

  assert.deepEqual(
    resolveTranslationChunking({
      TRANSLATION_CHUNK_SIZE: "5",
      TRANSLATION_CHUNK_CONCURRENCY: "3",
    }),
    { size: 5, concurrency: 3 }
  );

  // Nonsense values must not disable chunking or unleash unbounded concurrency.
  assert.deepEqual(
    resolveTranslationChunking({
      TRANSLATION_CHUNK_SIZE: "0",
      TRANSLATION_CHUNK_CONCURRENCY: "-4",
    }),
    {
      size: DEFAULT_TRANSLATION_CHUNK_SIZE,
      concurrency: DEFAULT_TRANSLATION_CHUNK_CONCURRENCY,
    }
  );
});

/**
 * Live measurement from jobspot.at (2026-08-03): one /api/translate call with
 * 120 fresh segments needed 28.2s because every text went into a single chat
 * completion, so latency scaled with the output-token count. Splitting the
 * work into bounded, concurrent provider calls is what keeps a cold page
 * inside the plugin's request timeout.
 */
test("splits a large batch into bounded parallel provider calls", async () => {
  const originalFetch = globalThis.fetch;
  const chunkSizes: number[] = [];
  let inFlight = 0;
  let peakInFlight = 0;

  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input.toString();
    if (!url.includes("openai.com")) {
      throw new Error(`Unexpected fetch url ${url}`);
    }

    const body = JSON.parse(String(init?.body ?? "{}"));
    const { texts } = JSON.parse(body.messages[1].content) as { texts: string[] };
    chunkSizes.push(texts.length);

    inFlight += 1;
    peakInFlight = Math.max(peakInFlight, inFlight);
    await new Promise((resolve) => setTimeout(resolve, 5));
    inFlight -= 1;

    return new Response(
      JSON.stringify({
        choices: [
          {
            message: {
              content: JSON.stringify({
                translations: texts.map((text) => ({ text: `en:${text}` })),
              }),
            },
          },
        ],
      })
    );
  }) as typeof fetch;

  try {
    const texts = Array.from({ length: 47 }, (_, index) => `Segment ${index}`);
    const result = await translateTexts(
      { texts, sourceLang: "de", targetLang: "en" },
      {
        TRANSLATION_PROVIDER: "openai",
        OPENAI_API_KEY: "openai-key",
        TRANSLATION_CHUNK_SIZE: "10",
        TRANSLATION_CHUNK_CONCURRENCY: "3",
      }
    );

    assert.deepEqual(chunkSizes, [10, 10, 10, 10, 7]);
    assert.ok(
      peakInFlight > 1,
      "chunks must overlap; a sequential loop would not shorten the cold-page latency"
    );
    assert.ok(
      peakInFlight <= 3,
      `concurrency must stay bounded, saw ${peakInFlight} parallel provider calls`
    );

    // Order is the contract the /api/translate route relies on to map results
    // back onto the request's word list.
    assert.deepEqual(
      result.map((entry) => entry.text),
      texts.map((text) => `en:${text}`)
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("keeps a single provider call for batches that fit into one chunk", async () => {
  const originalFetch = globalThis.fetch;
  let calls = 0;

  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    calls += 1;
    const body = JSON.parse(String(init?.body ?? "{}"));
    const { texts } = JSON.parse(body.messages[1].content) as { texts: string[] };

    return new Response(
      JSON.stringify({
        choices: [
          {
            message: {
              content: JSON.stringify({
                translations: texts.map((text) => ({ text: `en:${text}` })),
              }),
            },
          },
        ],
      })
    );
  }) as typeof fetch;

  try {
    await translateTexts(
      { texts: ["Hallo", "Welt"], sourceLang: "de", targetLang: "en" },
      { TRANSLATION_PROVIDER: "openai", OPENAI_API_KEY: "openai-key" }
    );

    assert.equal(calls, 1);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("surfaces a failing chunk instead of returning a partially translated batch", async () => {
  const originalFetch = globalThis.fetch;
  const originalError = console.error;
  console.error = () => {};
  let calls = 0;

  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    calls += 1;
    if (calls === 2) {
      return new Response('{"error":{"message":"Invalid API key"}}', { status: 401 });
    }

    const body = JSON.parse(String(init?.body ?? "{}"));
    const { texts } = JSON.parse(body.messages[1].content) as { texts: string[] };

    return new Response(
      JSON.stringify({
        choices: [
          {
            message: {
              content: JSON.stringify({
                translations: texts.map((text) => ({ text: `en:${text}` })),
              }),
            },
          },
        ],
      })
    );
  }) as typeof fetch;

  try {
    await assert.rejects(
      () =>
        translateTexts(
          {
            texts: Array.from({ length: 6 }, (_, index) => `Segment ${index}`),
            sourceLang: "de",
            targetLang: "en",
          },
          {
            TRANSLATION_PROVIDER: "openai",
            OPENAI_API_KEY: "openai-key",
            TRANSLATION_CHUNK_SIZE: "2",
            TRANSLATION_CHUNK_CONCURRENCY: "2",
          }
        ),
      /401/
    );
  } finally {
    globalThis.fetch = originalFetch;
    console.error = originalError;
  }
});

test("does not start more provider chunks after one concurrent chunk fails", async () => {
  const originalFetch = globalThis.fetch;
  const originalError = console.error;
  console.error = () => {};
  let calls = 0;

  globalThis.fetch = (async (_input: RequestInfo | URL, init?: RequestInit) => {
    calls += 1;

    if (calls === 1) {
      return new Response('{"error":{"message":"Invalid API key"}}', { status: 401 });
    }

    const body = JSON.parse(String(init?.body ?? "{}"));
    const { texts } = JSON.parse(body.messages[1].content) as { texts: string[] };
    await new Promise((resolve) => setTimeout(resolve, 25));

    return openAIResponse(texts.map((text) => ({ text: `en:${text}` })));
  }) as typeof fetch;

  try {
    await assert.rejects(
      () =>
        translateTexts(
          {
            texts: Array.from({ length: 6 }, (_, index) => `Segment ${index}`),
            sourceLang: "de",
            targetLang: "en",
          },
          {
            TRANSLATION_PROVIDER: "openai",
            OPENAI_API_KEY: "openai-key",
            TRANSLATION_CHUNK_SIZE: "1",
            TRANSLATION_CHUNK_CONCURRENCY: "2",
          }
        ),
      /401/
    );

    // Let the already-running second request finish. It must observe the
    // failure before pulling another chunk from the shared cursor.
    await new Promise((resolve) => setTimeout(resolve, 80));
    assert.equal(calls, 2, "only the two in-flight chunks may reach the provider");
  } finally {
    globalThis.fetch = originalFetch;
    console.error = originalError;
  }
});

/**
 * Three requests in 24h hit "Vercel Runtime Timeout Error: Task timed out
 * after 300 seconds" on /api/translate because the provider adapters called
 * `fetch` with no timeout — a hung upstream pinned the function until the
 * platform killed it, and the configured fallback provider never got a turn.
 * `isProviderFailoverError` already treats a TimeoutError as recoverable; the
 * deadline just has to exist.
 */
test("gives every provider call a deadline so a hung upstream cannot pin the request", { timeout: 10_000 }, async () => {
  const originalFetch = globalThis.fetch;
  const signals: Array<AbortSignal | null | undefined> = [];

  globalThis.fetch = ((input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input.toString();
    signals.push(init?.signal);

    if (url.includes("openai.com")) {
      // Never answers. Mirrors undici: reject with the signal's reason on abort.
      return new Promise((_resolve, reject) => {
        // AbortSignal.timeout() uses an unref'ed timer on newer Node releases.
        // Keep the test process alive long enough to observe that deadline.
        const watchdog = setTimeout(() => reject(new Error("abort deadline was not observed")), 1_000);
        init?.signal?.addEventListener("abort", () => {
          clearTimeout(watchdog);
          reject((init.signal as AbortSignal & { reason?: unknown }).reason);
        });
      });
    }

    return Promise.resolve(
      new Response(
        JSON.stringify({
          candidates: [
            {
              content: {
                parts: [{ text: '{"translations":[{"text":"rescued by the fallback"}]}' }],
              },
            },
          ],
        })
      )
    );
  }) as typeof fetch;

  try {
    const result = await translateTexts(
      { texts: ["Hallo"], sourceLang: "de", targetLang: "en" },
      {
        TRANSLATION_PROVIDER: "openai",
        OPENAI_API_KEY: "openai-key",
        GEMINI_API_KEY: "gemini-key",
        TRANSLATION_FALLBACK_PROVIDERS: "gemini",
        TRANSLATION_PROVIDER_TIMEOUT_MS: "60",
      }
    );

    assert.ok(
      signals[0] instanceof AbortSignal,
      "the provider fetch must carry an AbortSignal"
    );
    assert.deepEqual(
      result.map((entry) => entry.text),
      ["rescued by the fallback"],
      "a hung provider must time out and hand over to the fallback"
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("resolves the provider timeout from the environment with a sane default", () => {
  assert.equal(resolveProviderTimeoutMs({}), DEFAULT_PROVIDER_TIMEOUT_MS);
  assert.equal(resolveProviderTimeoutMs({ TRANSLATION_PROVIDER_TIMEOUT_MS: "5000" }), 5000);
  assert.equal(
    resolveProviderTimeoutMs({ TRANSLATION_PROVIDER_TIMEOUT_MS: "nonsense" }),
    DEFAULT_PROVIDER_TIMEOUT_MS
  );
  assert.equal(
    resolveProviderTimeoutMs({ TRANSLATION_PROVIDER_TIMEOUT_MS: "0" }),
    DEFAULT_PROVIDER_TIMEOUT_MS
  );

  // The deadline must leave room for the measured provider latency (~9s fixed
  // plus ~0.9s per segment) or it would abort healthy translations.
  assert.ok(DEFAULT_PROVIDER_TIMEOUT_MS >= 45_000);
});

test("keeps the shared provider deadline below the route duration", () => {
  assert.equal(
    resolveTranslationRequestTimeoutMs({}),
    DEFAULT_TRANSLATION_REQUEST_TIMEOUT_MS
  );
  assert.equal(
    resolveTranslationRequestTimeoutMs({ TRANSLATION_REQUEST_TIMEOUT_MS: "5000" }),
    5_000
  );
  assert.equal(
    resolveTranslationRequestTimeoutMs({
      TRANSLATION_REQUEST_TIMEOUT_MS: "120000",
    }),
    DEFAULT_TRANSLATION_REQUEST_TIMEOUT_MS,
    "an operator override must not consume the route's 20-second safety margin"
  );
  assert.equal(DEFAULT_TRANSLATION_REQUEST_TIMEOUT_MS, 100_000);
});

/**
 * Production repro (28 occurrences in the 3.7 days after #299 deployed):
 * "count-mismatch isolation stopped at provider-call budget 6 … batch size: 1".
 * Both providers drift on every multi-text shape; the previous tree descended 8→4→2→1,
 * and the walk to the first singleton alone costs 6 calls — so the budget
 * killed the repair at the exact moment it had isolated the problem. The
 * budget must be sized so the singleton repair can finish.
 */
test("completes isolation down to singletons instead of dying at the call budget", async () => {
  const originalFetch = globalThis.fetch;
  const originalWarn = console.warn;
  const originalError = console.error;
  let providerCalls = 0;

  console.warn = () => {};
  console.error = () => {};
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    providerCalls += 1;
    const url = typeof input === "string" ? input : input.toString();
    const body = JSON.parse(String(init?.body ?? "{}"));

    if (url.includes("openai.com")) {
      return openAIResponse([]);
    }
    if (url.includes("generativelanguage.googleapis.com")) {
      const { texts } = JSON.parse(body.contents[0].parts[0].text) as {
        texts: string[];
      };
      // The fallback drifts on multi-text shapes but can translate each
      // singleton after the primary also mismatches there.
      return geminiResponse(
        texts.length === 1 ? [{ text: `en:${texts[0]}` }] : []
      );
    }
    throw new Error(`Unexpected fetch url ${url}`);
  }) as typeof fetch;

  try {
    const texts = Array.from({ length: 8 }, (_, index) => `Segment ${index}`);
    const result = await translateTexts(
      { texts, sourceLang: "de", targetLang: "en" },
      {
        TRANSLATION_PROVIDER: "openai",
        OPENAI_API_KEY: "openai-key",
        GEMINI_API_KEY: "gemini-key",
        TRANSLATION_FALLBACK_PROVIDERS: "gemini",
      }
    );

    // Order is the contract the route maps results back with.
    assert.deepEqual(
      result.map((entry) => entry.text),
      texts.map((text) => `en:${text}`)
    );
    // The root exhausts both providers, then every singleton preserves the
    // full fallback chain. This reaches the exact two-provider ceiling:
    // chain length x (chunk size + 1) = 2 x 9.
    assert.equal(providerCalls, 2 * (8 + 1));
  } finally {
    globalThis.fetch = originalFetch;
    console.warn = originalWarn;
    console.error = originalError;
  }
});

/**
 * Isolation limits used to be sized for the default chunk of 8. An operator
 * chunk of 12 must still isolate every original text without hitting a call
 * ceiling sized for a smaller root.
 */
test("derives singleton isolation limits from a non-default chunk size", async () => {
  const originalFetch = globalThis.fetch;
  const originalWarn = console.warn;
  const originalError = console.error;

  console.warn = () => {};
  console.error = () => {};
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input.toString();
    const body = JSON.parse(String(init?.body ?? "{}"));

    if (url.includes("openai.com")) {
      const { texts } = JSON.parse(body.messages[1].content) as { texts: string[] };

      return openAIResponse(
        texts.length === 1 ? [{ text: `en:${texts[0]}` }] : []
      );
    }
    throw new Error(`Unexpected fetch url ${url}`);
  }) as typeof fetch;

  try {
    const texts = Array.from({ length: 12 }, (_, index) => `Absatz ${index}`);
    const result = await translateTexts(
      { texts, sourceLang: "de", targetLang: "en" },
      {
        TRANSLATION_PROVIDER: "openai",
        OPENAI_API_KEY: "openai-key",
        TRANSLATION_CHUNK_SIZE: "12",
      }
    );

    assert.deepEqual(
      result.map((entry) => entry.text),
      texts.map((text) => `en:${text}`)
    );
  } finally {
    globalThis.fetch = originalFetch;
    console.warn = originalWarn;
    console.error = originalError;
  }
});

/**
 * The chunk concurrency exists to stay clear of provider rate limits. Direct
 * singleton isolation must not create an independent pool for every root —
 * several drifting chunks could otherwise fan out far beyond that ceiling and
 * provoke the 429 that terminally kills the request.
 */
test("caps in-flight provider calls during parallel isolation at the request concurrency", async () => {
  const originalFetch = globalThis.fetch;
  const originalWarn = console.warn;
  const originalError = console.error;
  let inFlight = 0;
  let peakInFlight = 0;

  console.warn = () => {};
  console.error = () => {};
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input.toString();
    if (!url.includes("openai.com")) {
      throw new Error(`Unexpected fetch url ${url}`);
    }

    inFlight += 1;
    peakInFlight = Math.max(peakInFlight, inFlight);
    await new Promise((resolve) => setTimeout(resolve, 5));
    inFlight -= 1;

    const body = JSON.parse(String(init?.body ?? "{}"));
    const { texts } = JSON.parse(body.messages[1].content) as { texts: string[] };

    return openAIResponse(
      texts.length === 1 ? [{ text: `en:${texts[0]}` }] : []
    );
  }) as typeof fetch;

  try {
    // Two 8-text chunks that both drift on the root shape isolate concurrently
    // into 16 singleton calls.
    const texts = Array.from({ length: 16 }, (_, index) => `Segment ${index}`);
    const result = await translateTexts(
      { texts, sourceLang: "de", targetLang: "en" },
      {
        TRANSLATION_PROVIDER: "openai",
        OPENAI_API_KEY: "openai-key",
        TRANSLATION_CHUNK_SIZE: "8",
        TRANSLATION_CHUNK_CONCURRENCY: "3",
      }
    );

    assert.deepEqual(
      result.map((entry) => entry.text),
      texts.map((text) => `en:${text}`)
    );
    assert.ok(
      peakInFlight <= 3,
      `isolation must respect the request concurrency of 3, saw ${peakInFlight} in flight`
    );
    assert.ok(peakInFlight > 1, "the repair must still overlap calls");
  } finally {
    globalThis.fetch = originalFetch;
    console.warn = originalWarn;
    console.error = originalError;
  }
});

/**
 * Six default root chunks already exceed the shared request deadline when
 * every chunk walks its complete binary tree: 6 x 22 provider calls need at
 * least eleven 25-ms waves, which cannot fit a 240-ms deadline. Direct
 * singleton isolation needs only the two root-provider waves plus four
 * singleton waves, leaving enough margin for the same request to finish.
 */
test("keeps multi-chunk count-mismatch recovery inside the shared deadline", { timeout: 2_000 }, async () => {
  const originalFetch = globalThis.fetch;
  const originalWarn = console.warn;
  const originalError = console.error;
  let providerCalls = 0;

  console.warn = () => {};
  console.error = () => {};
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    providerCalls += 1;
    await new Promise((resolve) => setTimeout(resolve, 25));

    const url = typeof input === "string" ? input : input.toString();
    const body = JSON.parse(String(init?.body ?? "{}"));
    if (url.includes("openai.com")) {
      const { texts } = JSON.parse(body.messages[1].content) as { texts: string[] };
      return openAIResponse(
        texts.length === 1 ? [{ text: `en:${texts[0]}` }] : []
      );
    }
    if (url.includes("generativelanguage.googleapis.com")) {
      return geminiResponse([]);
    }
    throw new Error(`Unexpected fetch url ${url}`);
  }) as typeof fetch;

  try {
    const texts = Array.from({ length: 48 }, (_, index) => `Segment ${index}`);
    const result = await translateTexts(
      { texts, sourceLang: "de", targetLang: "en" },
      {
        TRANSLATION_PROVIDER: "openai",
        OPENAI_API_KEY: "openai-key",
        GEMINI_API_KEY: "gemini-key",
        TRANSLATION_FALLBACK_PROVIDERS: "gemini",
        TRANSLATION_CHUNK_SIZE: "8",
        TRANSLATION_CHUNK_CONCURRENCY: "12",
        TRANSLATION_PROVIDER_TIMEOUT_MS: "1000",
        TRANSLATION_REQUEST_TIMEOUT_MS: "240",
      }
    );

    assert.deepEqual(
      result.map((entry) => entry.text),
      texts.map((text) => `en:${text}`)
    );
    assert.ok(
      providerCalls <= 60,
      `six default chunks should need at most 60 calls, saw ${providerCalls}`
    );
  } finally {
    globalThis.fetch = originalFetch;
    console.warn = originalWarn;
    console.error = originalError;
  }
});

/**
 * A 100-text request has thirteen default root chunks. Even when every
 * singleton succeeds on the first provider, direct isolation would need 126
 * calls; at 25 ms per call and twelve request-wide slots, that work cannot fit
 * after the root chains have consumed part of a 240-ms shared deadline. The
 * request must classify that impossibility before starting singleton work
 * instead of spending until the deadline aborts it.
 */
test("rejects request-wide count-mismatch recovery before impossible singleton work starts", { timeout: 2_000 }, async () => {
  const originalFetch = globalThis.fetch;
  const originalWarn = console.warn;
  const originalError = console.error;
  let providerCalls = 0;
  const errors: string[] = [];

  console.warn = () => {};
  console.error = (...args) => {
    errors.push(args.map((value) => String(value)).join(" "));
  };
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    providerCalls += 1;
    await new Promise((resolve) => setTimeout(resolve, 25));

    const url = typeof input === "string" ? input : input.toString();
    const body = JSON.parse(String(init?.body ?? "{}"));
    if (url.includes("openai.com")) {
      const { texts } = JSON.parse(body.messages[1].content) as { texts: string[] };
      return openAIResponse(
        texts.length === 1 ? [{ text: `en:${texts[0]}` }] : []
      );
    }
    if (url.includes("generativelanguage.googleapis.com")) {
      return geminiResponse([]);
    }
    throw new Error(`Unexpected fetch url ${url}`);
  }) as typeof fetch;

  try {
    await assert.rejects(
      () =>
        translateTexts(
          {
            texts: Array.from({ length: 100 }, (_, index) => `Segment ${index}`),
            sourceLang: "de",
            targetLang: "en",
          },
          {
            TRANSLATION_PROVIDER: "openai",
            OPENAI_API_KEY: "openai-key",
            GEMINI_API_KEY: "gemini-key",
            TRANSLATION_FALLBACK_PROVIDERS: "gemini",
            TRANSLATION_CHUNK_SIZE: "8",
            TRANSLATION_CHUNK_CONCURRENCY: "12",
            TRANSLATION_PROVIDER_TIMEOUT_MS: "1000",
            TRANSLATION_REQUEST_TIMEOUT_MS: "240",
          }
        ),
      (error: unknown) => {
        assert.ok(error instanceof Error);
        assert.equal(error.name, "TranslationCountMismatchDeadlineError");
        assert.match(error.message, /cannot fit the remaining request deadline/i);
        return true;
      }
    );
    assert.equal(
      providerCalls,
      26,
      "the thirteen two-provider root chains must finish without starting singleton calls"
    );
    assert.equal(errors.length, 1, "the admission failure needs one terminal log");
    assert.match(errors[0], /cannot fit the remaining request deadline/i);
    assert.match(errors[0], /mismatch texts: 100, optimistic waves: 9/);
    assert.doesNotMatch(
      JSON.stringify(errors),
      /Segment 0|Segment 99/,
      "the admission log must not contain source text"
    );
  } finally {
    globalThis.fetch = originalFetch;
    console.warn = originalWarn;
    console.error = originalError;
  }
});
