import test from "node:test";
import assert from "node:assert/strict";

import {
  DEFAULT_PROVIDER_TIMEOUT_MS,
  DEFAULT_TRANSLATION_CHUNK_CONCURRENCY,
  DEFAULT_TRANSLATION_CHUNK_SIZE,
  countWords,
  resolveProviderTimeoutMs,
  resolveTranslationChunking,
  resolveTranslationProvider,
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
        init?.signal?.addEventListener("abort", () => {
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
