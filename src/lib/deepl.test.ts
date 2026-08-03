import { after, describe, it } from "node:test";
import assert from "node:assert";

import { translateWithDeepL } from "./deepl";
import { TranslationProviderResponseError } from "./translation-types";

const originalFetch = globalThis.fetch;

function installJsonResponse(payload: unknown) {
  globalThis.fetch = (async () =>
    new Response(JSON.stringify(payload), {
      status: 200,
      headers: { "content-type": "application/json" },
    })) as typeof fetch;
}

function translate(texts: string[]) {
  return translateWithDeepL(
    { texts, sourceLang: "de", targetLang: "en" },
    { DEEPL_API_KEY: "test-key" }
  );
}

async function assertResponseContractError(
  action: () => Promise<unknown>,
  message: RegExp
) {
  await assert.rejects(
    action,
    (error: unknown) =>
      error instanceof TranslationProviderResponseError &&
      message.test(error.message)
  );
}

describe("translateWithDeepL response contract", () => {
  after(() => {
    globalThis.fetch = originalFetch;
  });

  it("accepts one valid translation for every input", async () => {
    installJsonResponse({
      translations: [
        {
          text: "Hello",
          detected_source_language: "DE",
          provider_extra: "drop-me",
        },
        { text: "World", detected_source_language: 42 },
      ],
    });

    assert.deepEqual(await translate(["Hallo", "Welt"]), [
      { text: "Hello", detectedSourceLanguage: "DE" },
      { text: "World" },
    ]);
  });

  it("rejects an unparseable JSON envelope with the typed provider response error", async () => {
    globalThis.fetch = (async () =>
      new Response("not-json", {
        status: 200,
        headers: { "content-type": "application/json" },
      })) as typeof fetch;

    await assertResponseContractError(
      () => translate(["Hallo"]),
      /JSON|envelope/i
    );
  });

  it("rejects a non-object JSON envelope", async () => {
    installJsonResponse([]);

    await assertResponseContractError(
      () => translate(["Hallo"]),
      /envelope/i
    );
  });

  it("rejects a response without a translations array", async () => {
    installJsonResponse({ translations: null });

    await assertResponseContractError(
      () => translate(["Hallo"]),
      /translations.*array/i
    );
  });

  it("rejects a translations array with the wrong cardinality", async () => {
    installJsonResponse({ translations: [{ text: "Only one" }] });

    await assertResponseContractError(
      () => translate(["Erster", "Zweiter"]),
      /1.*2/
    );
  });

  it("rejects an invalid translation entry", async () => {
    installJsonResponse({ translations: [{ text: 42 }] });

    await assertResponseContractError(
      () => translate(["Hallo"]),
      /entry 1/i
    );
  });

  it("rejects a whitespace-only translation entry", async () => {
    installJsonResponse({ translations: [{ text: " \n\t " }] });

    await assertResponseContractError(
      () => translate(["Hallo"]),
      /entry 1/i
    );
  });
});
