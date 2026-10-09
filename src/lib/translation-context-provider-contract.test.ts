import test from "node:test";
import assert from "node:assert/strict";

import { translateWithDeepL } from "@/lib/deepl";
import { translateWithGemini } from "@/lib/gemini";
import { translateWithOpenAICompatible } from "@/lib/openai";
import { translateTexts } from "@/lib/translation";
import { buildTranslationContext } from "@/lib/translation-context-settings";
import type { TranslationProviderName } from "@/lib/translation-types";

const context = buildTranslationContext({
  settings: { websiteDescription: "A clinic", translationTone: "warm", useGlossaryAsContext: true },
  texts: ["Book an appointment"],
  glossaryRules: [{ originalTerm: "appointment", translatedTerm: "Termin" }],
});

test("configured fallback receives the identical context after a retryable provider failure", async () => {
  const originalFetch = globalThis.fetch;
  const contexts: string[] = [];
  globalThis.fetch = (async (url, init) => {
    if (String(url).includes("api.openai.com")) {
      const body = JSON.parse(String(init?.body));
      contexts.push(JSON.parse(body.messages[1].content).projectContext);
      return new Response("rate limited", { status: 429 });
    }
    const body = JSON.parse(String(init?.body));
    contexts.push(JSON.parse(body.contents[0].parts[0].text).projectContext);
    return new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: JSON.stringify({ translations: [{ text: "Termin buchen" }] }) }] } }] }));
  }) as typeof fetch;
  try {
    const result = await translateTexts(input, {
      TRANSLATION_PROVIDER: "openai",
      OPENAI_API_KEY: "fixture-openai-key",
      GEMINI_API_KEY: "fixture-gemini-key",
      TRANSLATION_FALLBACK_PROVIDERS: "gemini",
    });
    assert.equal(result[0]?.text, "Termin buchen");
    assert.deepEqual(contexts, [context, context]);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
assert.ok(context);
const input = { texts: ["Book an appointment"], sourceLang: "en", targetLang: "de", projectContext: context };

test("all hosted provider adapters receive the same bounded project context without key material", async () => {
  const originalFetch = globalThis.fetch;
  const requests: Array<{ url: string; body: string }> = [];
  globalThis.fetch = (async (url, init) => {
    const address = String(url);
    requests.push({ url: address, body: String(init?.body ?? "") });
    const response = address.includes("deepl.com")
      ? { translations: [{ text: "Termin buchen" }] }
      : address.includes("generateContent")
        ? { candidates: [{ content: { parts: [{ text: JSON.stringify({ translations: [{ text: "Termin buchen" }] }) }] } }] }
        : { choices: [{ message: { content: JSON.stringify({ translations: [{ text: "Termin buchen" }] }) } }] };
    return new Response(JSON.stringify(response));
  }) as typeof fetch;
  try {
    for (const provider of ["openai", "openrouter", "ollama", "openai-compatible"] as TranslationProviderName[]) {
      await translateWithOpenAICompatible(input, {
        provider,
        model: "fixture-model",
        baseUrl: "https://fixture.example/v1",
        apiKey: "secret-test-key",
      });
    }
    await translateWithGemini(input, { provider: "gemini", model: "fixture-model", apiKey: "secret-test-key" });
    await translateWithDeepL(input, { DEEPL_API_KEY: "secret-test-key" });
  } finally {
    globalThis.fetch = originalFetch;
  }
  assert.equal(requests.length, 6);
  for (const request of requests) {
    const body = request.url.includes("deepl.com")
      ? new URLSearchParams(request.body).get("context") ?? ""
      : request.body;
    assert.match(body, /Website description: A clinic/);
    assert.match(body, /Term: appointment => Termin/);
    assert.doesNotMatch(request.body, /secret-test-key/);
  }
});
