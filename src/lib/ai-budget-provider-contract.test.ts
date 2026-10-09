import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import { translateWithOpenAICompatible } from "@/lib/openai";
import { translateWithGemini } from "@/lib/gemini";
import { translateWithDeepL } from "@/lib/deepl";
import { translateTexts } from "@/lib/translation";
import { AiBudgetError } from "@/lib/ai-budget-math";

const originalFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = originalFetch; });
const input = { texts: ["Hallo"], sourceLang: "de", targetLang: "en" };

test("OpenAI-compatible adapter limits output and reports provider token receipt", async () => {
  let body: Record<string, unknown> | undefined;
  globalThis.fetch = async (_url, options) => {
    body = JSON.parse(String(options?.body)) as Record<string, unknown>;
    return Response.json({ choices: [{ message: { content: JSON.stringify({ translations: [{ text: "Hello" }] }) } }],
      usage: { prompt_tokens: 40, completion_tokens: 8 } });
  };
  let receipt: unknown;
  const result = await translateWithOpenAICompatible(input,
    { provider: "openai", model: "gpt-5-mini", baseUrl: "https://api.openai.com/v1", apiKey: "fixture", maxOutputUnits: 64,
      onUsage: (usage) => { receipt = usage; } });
  assert.equal(body?.max_completion_tokens, 64);
  assert.deepEqual(receipt, { inputUnits: 40, outputUnits: 8 });
  assert.equal(result[0].text, "Hello");
});

test("Gemini adapter limits output and reports provider token receipt", async () => {
  let body: { generationConfig?: { maxOutputTokens?: number } } | undefined;
  globalThis.fetch = async (_url, options) => {
    body = JSON.parse(String(options?.body)) as typeof body;
    return Response.json({ candidates: [{ content: { parts: [{ text: JSON.stringify({ translations: [{ text: "Hello" }] }) }] } }],
      usageMetadata: { promptTokenCount: 45, candidatesTokenCount: 9 } });
  };
  let receipt: unknown;
  const result = await translateWithGemini(input,
    { provider: "gemini", model: "fixture", apiKey: "fixture", maxOutputUnits: 64,
      onUsage: (usage) => { receipt = usage; } });
  assert.equal(body?.generationConfig?.maxOutputTokens, 64);
  assert.deepEqual(receipt, { inputUnits: 45, outputUnits: 9 });
  assert.equal(result[0].text, "Hello");
});

test("Gemini reconciles thinking tokens as output and rejects inconsistent or malformed totals", async () => {
  const response = (usageMetadata: Record<string, unknown>) => Response.json({
    candidates: [{ content: { parts: [{ text: JSON.stringify({ translations: [{ text: "Hello" }] }) }] } }],
    usageMetadata,
  });
  const cases: Array<{ metadata: Record<string, unknown>; expected: unknown }> = [
    { metadata: { promptTokenCount: 45, candidatesTokenCount: 9, thoughtsTokenCount: 12, totalTokenCount: 66 },
      expected: { inputUnits: 45, outputUnits: 21 } },
    { metadata: { promptTokenCount: 45, candidatesTokenCount: 9, thoughtsTokenCount: "12", totalTokenCount: 66 }, expected: undefined },
    { metadata: { promptTokenCount: 45, candidatesTokenCount: 9, thoughtsTokenCount: 12, totalTokenCount: 54 }, expected: undefined },
    { metadata: { promptTokenCount: 45, candidatesTokenCount: Number.MAX_SAFE_INTEGER, thoughtsTokenCount: 12 }, expected: undefined },
  ];
  for (const { metadata, expected } of cases) {
    globalThis.fetch = async () => response(metadata);
    let receipt: unknown;
    await translateWithGemini(input, { provider: "gemini", model: "fixture", apiKey: "fixture", maxOutputUnits: 64,
      onUsage: (usage) => { receipt = usage; } });
    assert.deepEqual(receipt, expected);
  }
});

test("DeepL requests billed characters and reconciles only an integer provider receipt", async () => {
  let requested = false;
  globalThis.fetch = async (_url, options) => {
    requested = new URLSearchParams(String(options?.body)).get("show_billed_characters") === "true";
    return Response.json({ translations: [{ text: "Hello", billed_characters: 5 }] });
  };
  let receipt: unknown;
  await translateWithDeepL(input, { DEEPL_API_KEY: "fixture" }, AbortSignal.timeout(1000),
    (usage) => { receipt = usage; });
  assert.equal(requested, true);
  assert.deepEqual(receipt, { inputUnits: 5, outputUnits: 0 });
});

test("DeepL missing or malformed billed-character receipt keeps usage unknown", async () => {
  for (const billed_characters of [undefined, "5", -1]) {
    globalThis.fetch = async () => Response.json({ translations: [{ text: "Hello", billed_characters }] });
    let receipt: unknown;
    await translateWithDeepL(input, { DEEPL_API_KEY: "fixture" }, AbortSignal.timeout(1000),
      (usage) => { receipt = usage; });
    assert.equal(receipt, undefined);
  }
});

test("unapproved primary attempt cannot reach provider HTTP", async () => {
  let httpCalls = 0;
  globalThis.fetch = async () => { httpCalls += 1; throw new Error("unexpected HTTP"); };
  await assert.rejects(() => translateTexts(input, {
    TRANSLATION_PROVIDER: "openai", OPENAI_API_KEY: "fixture", TRANSLATION_FALLBACK_PROVIDERS: "",
  }, null, { spendControl: { beforeAttempt: async () => { throw new AiBudgetError("budget_unapproved", "Approval missing."); } } }),
  { code: "budget_unapproved" });
  assert.equal(httpCalls, 0);
});

test("fallback is admitted separately and cannot bypass an unapproved model", async () => {
  let httpCalls = 0;
  globalThis.fetch = async () => {
    httpCalls += 1;
    return new Response("rate limited", { status: 429 });
  };
  const seen: string[] = [];
  await assert.rejects(() => translateTexts(input, {
    TRANSLATION_PROVIDER: "openai", OPENAI_API_KEY: "fixture", GEMINI_API_KEY: "fixture",
    TRANSLATION_FALLBACK_PROVIDERS: "gemini",
  }, null, { spendControl: { beforeAttempt: async (config) => {
    seen.push(config.provider);
    if (config.provider === "gemini") throw new AiBudgetError("model_not_approved", "Fallback model is not approved.");
    return { maxOutputUnits: 64, settle: async () => {} };
  } } }), { code: "model_not_approved" });
  assert.deepEqual(seen, ["openai", "gemini"]);
  assert.equal(httpCalls, 1);
});
