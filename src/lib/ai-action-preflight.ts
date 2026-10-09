import { preflightAiSpend } from "@/lib/ai-budget";
import { buildFallbackProviderChain, resolveTranslationProviderConfig,
  validateTranslationProviderConfig, type TranslationSettingsLike } from "@/lib/translation-config";
import { resolveTranslationChunking } from "@/lib/translation";
import type { TranslateTextsInput, TranslationEnv } from "@/lib/translation-types";

/** Read-only upper envelope: every fallback and bounded singleton repair may run. */
export async function preflightTranslationAction(input: {
  organizationId: string; projectId: string; dispatchInput: TranslateTextsInput;
  settings: TranslationSettingsLike | null; env?: TranslationEnv;
}) {
  const env = input.env ?? process.env;
  const primary = resolveTranslationProviderConfig({ settings: input.settings, env });
  const chain = buildFallbackProviderChain(primary, env);
  const size = resolveTranslationChunking(env).size;
  const attempts: Array<{ provider: string; model: string; inputUnits: number;
    outputUnits: number; maxMicros: string; unit: string }> = [];
  let allAllowed = true;
  let firstQuote: Awaited<ReturnType<typeof preflightAiSpend>> | null = null;
  for (let index = 0; index < input.dispatchInput.texts.length; index += size) {
    const texts = input.dispatchInput.texts.slice(index, index + size);
    const shapes = [texts, ...(texts.length > 1 ? texts.map((text) => [text]) : [])];
    for (const shape of shapes) for (const candidate of chain) {
      validateTranslationProviderConfig(candidate);
      const quote = await preflightAiSpend({ organizationId: input.organizationId,
        projectId: input.projectId, provider: candidate.provider,
        model: candidate.model || candidate.provider,
        dispatchInput: { ...input.dispatchInput, texts: shape } });
      firstQuote ??= quote;
      allAllowed &&= quote.allowed;
      attempts.push({ provider: candidate.provider, model: candidate.model || candidate.provider,
        inputUnits: quote.inputUnits, outputUnits: quote.outputUnits,
        maxMicros: quote.estimatedMaxMicros, unit: quote.unit });
    }
  }
  if (!attempts.length) return { allowed: true, attempts, maxMicros: "0", currency: null,
    code: "no_provider_work" };
  const first = firstQuote!;
  const max = attempts.reduce((total, item) => total + BigInt(item.maxMicros), BigInt(0));
  const remaining = BigInt(first.organizationRemainingMicros) < BigInt(first.projectRemainingMicros)
    ? BigInt(first.organizationRemainingMicros) : BigInt(first.projectRemainingMicros);
  const allowed = allAllowed && max <= remaining;
  return { allowed, attempts, maxMicros: max.toString(),
    currency: first.currency, code: allowed ? "approved_estimate" : "budget_exhausted" };
}
