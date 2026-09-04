import { describe, it, after } from "node:test";
import assert from "node:assert";

import { translateWithGemini } from "./gemini";
import {
  TranslationProviderCountMismatchError,
  TranslationProviderResponseError,
} from "./translation-types";

type RecordedRequest = { url: string; method: string; headers: Headers; body: string };

const originalFetch = globalThis.fetch;

function installFetchMock(handler: (req: RecordedRequest) => Response | Promise<Response>) {
  const recorded: RecordedRequest[] = [];
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input.toString();
    const headers = new Headers(init?.headers);
    const body = typeof init?.body === "string" ? init.body : "";
    const req: RecordedRequest = { url, method: init?.method ?? "GET", headers, body };
    recorded.push(req);
    return handler(req);
  }) as typeof fetch;
  return recorded;
}

describe("translateWithGemini", () => {
  after(() => {
    globalThis.fetch = originalFetch;
  });

  it("sends a single generateContent request that asks for strict JSON and parses the response back into TranslationResult[]", async () => {
    const recorded = installFetchMock(() => {
      const payload = {
        candidates: [
          {
            content: {
              parts: [
                {
                  text: JSON.stringify({
                    translations: [
                      { text: "Hello", detectedSourceLanguage: "de" },
                      { text: "world", detectedSourceLanguage: "de" },
                    ],
                  }),
                },
              ],
            },
          },
        ],
      };
      return new Response(JSON.stringify(payload), { status: 200, headers: { "content-type": "application/json" } });
    });

    const result = await translateWithGemini(
      { texts: ["Hallo", "Welt"], sourceLang: "de", targetLang: "en" },
      { provider: "gemini", model: "gemini-2.5-flash-lite", apiKey: "test-key" }
    );

    assert.equal(recorded.length, 1, "exactly one request");
    assert.equal(recorded[0].method, "POST");
    assert.match(recorded[0].url, /^https:\/\/generativelanguage\.googleapis\.com\/v1beta\/models\/gemini-2\.5-flash-lite:generateContent\?key=test-key$/);
    const body = JSON.parse(recorded[0].body);
    assert.equal(body.generationConfig?.responseMimeType, "application/json");
    assert.deepEqual(result, [
      { text: "Hello", detectedSourceLanguage: "de" },
      { text: "world", detectedSourceLanguage: "de" },
    ]);
  });

  it("passes website type and industry context in the structured user payload", async () => {
    const recorded = installFetchMock(() =>
      new Response(
        JSON.stringify({
          candidates: [
            {
              content: {
                parts: [
                  {
                    text: JSON.stringify({ translations: [{ text: "Welcome" }] }),
                  },
                ],
              },
            },
          ],
        }),
      ),
    );

    await translateWithGemini(
      {
        texts: ["Willkommen"],
        sourceLang: "de",
        targetLang: "en",
        websiteType: "Hotel website",
        industryType: "Hospitality & tourism",
      },
      { provider: "gemini", model: "gemini-2.5-flash-lite", apiKey: "test-key" },
    );

    const body = JSON.parse(recorded[0].body);
    const systemPrompt = body.systemInstruction.parts[0].text;
    assert.match(systemPrompt, /websiteType and industryType/);
    assert.match(systemPrompt, /terminology and tone/);
    assert.match(
      systemPrompt,
      /Do not translate or return those context fields/,
    );
    const payload = JSON.parse(body.contents[0].parts[0].text);
    assert.deepEqual(payload, {
      sourceLang: "de",
      targetLang: "en",
      websiteType: "Hotel website",
      industryType: "Hospitality & tourism",
      texts: ["Willkommen"],
    });
  });

  it("uses the configured base URL when provided", async () => {
    const recorded = installFetchMock(() => {
      return new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: JSON.stringify({ translations: [{ text: "Hi" }] }) }] } }] }));
    });

    await translateWithGemini(
      { texts: ["Hallo"], sourceLang: "de", targetLang: "en" },
      { provider: "gemini", model: "gemini-2.5-pro", baseUrl: "https://proxy.example.com/v1", apiKey: "k" }
    );

    assert.equal(recorded[0].url, "https://proxy.example.com/v1/models/gemini-2.5-pro:generateContent?key=k");
  });

  it("rejects when no api key is configured", async () => {
    await assert.rejects(
      () =>
        translateWithGemini(
          { texts: ["x"], sourceLang: "de", targetLang: "en" },
          { provider: "gemini", model: "gemini-2.5-flash-lite" }
        ),
      /Gemini API key/
    );
  });

  it("throws a clear error when Gemini returns a non-2xx response", async () => {
    installFetchMock(() => new Response('{"error":{"message":"rate limit"}}', { status: 429 }));

    await assert.rejects(
      () =>
        translateWithGemini(
          { texts: ["x"], sourceLang: "de", targetLang: "en" },
          { provider: "gemini", model: "gemini-2.5-flash-lite", apiKey: "k" }
        ),
      /Gemini API error 429/
    );
  });

  it("treats malformed response payloads as a translation failure rather than crashing", async () => {
    installFetchMock(() => new Response("not-json"));

    await assert.rejects(
      () =>
        translateWithGemini(
          { texts: ["x"], sourceLang: "de", targetLang: "en" },
          { provider: "gemini", model: "gemini-2.5-flash-lite", apiKey: "k" }
        )
    );
  });

  it("rejects a partial result instead of returning cacheable source-text identities", async () => {
    installFetchMock(() => {
      const payload = {
        candidates: [
          {
            content: {
              parts: [
                {
                  text: JSON.stringify({
                    translations: [
                      { text: "only-one" },
                    ],
                  }),
                },
              ],
            },
          },
        ],
      };
      return new Response(JSON.stringify(payload));
    });

    await assert.rejects(
      () =>
        translateWithGemini(
          { texts: ["First", "Second"], sourceLang: "de", targetLang: "en" },
          { provider: "gemini", model: "gemini-2.5-flash-lite", apiKey: "k" }
        ),
      (error: unknown) =>
        error instanceof TranslationProviderCountMismatchError &&
        error.actualCount === 1 &&
        error.expectedCount === 2
    );
  });

  it("classifies non-array candidate parts as a provider response error", async () => {
    installFetchMock(() =>
      new Response(
        JSON.stringify({
          candidates: [{ content: { parts: { text: "not-an-array" } } }],
        })
      )
    );

    await assert.rejects(
      () =>
        translateWithGemini(
          { texts: ["Hallo"], sourceLang: "de", targetLang: "en" },
          { provider: "gemini", model: "gemini-2.5-flash-lite", apiKey: "k" }
        ),
      (error: unknown) => error instanceof TranslationProviderResponseError
    );
  });

  it("rejects whitespace-only translations", async () => {
    installFetchMock(() =>
      new Response(
        JSON.stringify({
          candidates: [
            {
              content: {
                parts: [
                  {
                    text: JSON.stringify({ translations: [{ text: " \t " }] }),
                  },
                ],
              },
            },
          ],
        })
      )
    );

    await assert.rejects(
      () =>
        translateWithGemini(
          { texts: ["Hallo"], sourceLang: "de", targetLang: "en" },
          { provider: "gemini", model: "gemini-2.5-flash-lite", apiKey: "k" }
        ),
      (error: unknown) => error instanceof TranslationProviderResponseError
    );
  });
});
