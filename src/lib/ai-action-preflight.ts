import { preflightAiSpendBatch } from "@/lib/ai-budget";
import { buildFallbackProviderChain, resolveTranslationProviderConfig,
  validateTranslationProviderConfig, type TranslationSettingsLike } from "@/lib/translation-config";
import { resolveTranslationChunking } from "@/lib/translation";
import type { TranslateTextsInput, TranslationEnv } from "@/lib/translation-types";

/** Read-only upper envelope: every configured fallback and bounded singleton repair may run. */
export async function preflightTranslationAction(input: {
  organizationId: string; projectId: string; dispatchInput: TranslateTextsInput;
  settings: TranslationSettingsLike | null; env?: TranslationEnv;
}) {
  const env = input.env ?? process.env;
  const primary = resolveTranslationProviderConfig({ settings: input.settings, env });
  const chain = buildFallbackProviderChain(primary, env);
  for (const candidate of chain) validateTranslationProviderConfig(candidate);
  const size = resolveTranslationChunking(env).size;
  const attempts: Array<{ provider: string; model: string;
    dispatchInput: TranslateTextsInput }> = [];
  for (let index = 0; index < input.dispatchInput.texts.length; index += size) {
    const texts = input.dispatchInput.texts.slice(index, index + size);
    const shapes = [texts, ...(texts.length > 1 ? texts.map((text) => [text]) : [])];
    for (const shape of shapes) for (const candidate of chain)
      attempts.push({ provider: candidate.provider, model: candidate.model || candidate.provider,
        dispatchInput: { ...input.dispatchInput, texts: shape } });
  }
  return preflightAiSpendBatch({ organizationId: input.organizationId,
    projectId: input.projectId, attempts });
}
