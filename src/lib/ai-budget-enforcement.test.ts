import assert from "node:assert/strict";
import { test } from "node:test";
import { aiBudgetEnforcementState, selectAiBudgetSpendControl } from "@/lib/ai-budget-enforcement";
import { AiBudgetError } from "@/lib/ai-budget-math";
import { translateTexts } from "@/lib/translation";

test("enforcement defaults off and requires an explicit valid on value", () => {
  assert.equal(aiBudgetEnforcementState(undefined), "inactive");
  assert.equal(aiBudgetEnforcementState("off"), "inactive");
  assert.equal(aiBudgetEnforcementState("on"), "active");
  assert.throws(() => aiBudgetEnforcementState("true"), /AI_BUDGET_ENFORCEMENT/);
});

test("inactive rollout preserves legacy provider dispatch; active rollout denies unapproved dispatch", async () => {
  const originalFetch = globalThis.fetch;
  let httpCalls = 0;
  const control = { beforeAttempt: async () => {
    throw new AiBudgetError("budget_unapproved", "No owner approval.");
  } };
  globalThis.fetch = async () => {
    httpCalls += 1;
    return Response.json({ choices: [{ message: { content: JSON.stringify({ translations: [{ text: "Hello" }] }) } }] });
  };
  try {
    const input = { texts: ["Hallo"], sourceLang: "de", targetLang: "en" };
    const env = { TRANSLATION_PROVIDER: "openai", OPENAI_API_KEY: "fixture", TRANSLATION_FALLBACK_PROVIDERS: "" };
    const legacy = await translateTexts(input, env, null,
      { spendControl: selectAiBudgetSpendControl("inactive", control) });
    assert.equal(legacy[0].text, "Hello");
    assert.equal(httpCalls, 1);
    await assert.rejects(() => translateTexts(input, env, null,
      { spendControl: selectAiBudgetSpendControl("active", control) }), { code: "budget_unapproved" });
    assert.equal(httpCalls, 1);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
