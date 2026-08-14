import { after, describe, it } from "node:test";
import assert from "node:assert/strict";

import { translateWithOpenAICompatible } from "./openai";
import {
  TranslationProviderCountMismatchError,
  TranslationProviderResponseError,
} from "./translation-types";

const originalFetch = globalThis.fetch;

const config = {
  provider: "openai" as const,
  model: "gpt-5-mini",
  baseUrl: "https://api.openai.com/v1",
  apiKey: "test-key",
};

function installModelContent(content: string): void {
  globalThis.fetch = (async () =>
    new Response(
      JSON.stringify({
        choices: [{ message: { content } }],
      })
    )) as typeof fetch;
}

function assertProviderResponseError(error: unknown): boolean {
  return error instanceof TranslationProviderResponseError;
}

describe("translateWithOpenAICompatible response validation", () => {
  after(() => {
    globalThis.fetch = originalFetch;
  });

  it("classifies a JSON null model payload as a provider response error", async () => {
    installModelContent("null");

    await assert.rejects(
      () =>
        translateWithOpenAICompatible(
          { texts: ["Hallo"], sourceLang: "de", targetLang: "en" },
          config
        ),
      assertProviderResponseError
    );
  });

  it("classifies a malformed translation object as a provider response error", async () => {
    installModelContent(JSON.stringify({ translations: [{}] }));

    await assert.rejects(
      () =>
        translateWithOpenAICompatible(
          { texts: ["Hallo"], sourceLang: "de", targetLang: "en" },
          config
        ),
      assertProviderResponseError
    );
  });

  it("classifies only wrong result cardinality as a count mismatch", async () => {
    installModelContent(JSON.stringify({ translations: [{ text: "Only one" }] }));

    await assert.rejects(
      () =>
        translateWithOpenAICompatible(
          { texts: ["Hallo", "Welt"], sourceLang: "de", targetLang: "en" },
          config
        ),
      (error: unknown) =>
        error instanceof TranslationProviderCountMismatchError &&
        error.actualCount === 1 &&
        error.expectedCount === 2
    );
  });

  it("rejects whitespace-only translations", async () => {
    installModelContent(JSON.stringify({ translations: [{ text: " \t " }] }));

    await assert.rejects(
      () =>
        translateWithOpenAICompatible(
          { texts: ["Hallo"], sourceLang: "de", targetLang: "en" },
          config
        ),
      assertProviderResponseError
    );
  });
});
