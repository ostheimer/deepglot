import { translateWithDeepL } from "@/lib/deepl";
import { translateWithGemini } from "@/lib/gemini";
import { translateWithOpenAICompatible } from "@/lib/openai";
import {
  buildFallbackProviderChain,
  resolveTranslationProviderConfig,
  validateTranslationProviderConfig,
  type TranslationProviderConfig,
  type TranslationSettingsLike,
} from "@/lib/translation-config";
import type {
  TranslateTextsInput,
  TranslationEnv,
  TranslationProviderName,
  TranslationResult,
} from "@/lib/translation-types";
export { countWords } from "@/lib/translation-types";

function translateWithMock({
  texts,
  sourceLang,
  targetLang,
}: TranslateTextsInput): TranslationResult[] {
  return texts.map((text) => {
    if (!text.trim() || sourceLang.toLowerCase() === targetLang.toLowerCase()) {
      return {
        detectedSourceLanguage: sourceLang.toUpperCase(),
        text,
      };
    }

    return {
      detectedSourceLanguage: sourceLang.toUpperCase(),
      text: `[${targetLang.toLowerCase()}] ${text}`,
    };
  });
}

export function resolveTranslationProvider(
  env: TranslationEnv = process.env,
  settings?: TranslationSettingsLike | null
): TranslationProviderName {
  return resolveTranslationProviderConfig({ settings, env }).provider;
}

async function translateWithProvider(
  input: TranslateTextsInput,
  env: TranslationEnv,
  config: TranslationProviderConfig
): Promise<TranslationResult[]> {
  switch (config.provider) {
    case "openai":
    case "openrouter":
    case "ollama":
    case "openai-compatible":
      return translateWithOpenAICompatible(input, config);
    case "gemini":
      return translateWithGemini(input, config);
    case "deepl":
      validateTranslationProviderConfig(config);
      return translateWithDeepL(input, { ...env, DEEPL_API_KEY: config.apiKey });
    case "mock":
      return translateWithMock(input);
    default:
      throw new Error(`Provider '${config.provider}' is not supported.`);
  }
}

/**
 * Errors the fallback wrapper treats as "try the next provider":
 * quota / rate-limit responses, gateway/timeout errors and the catch-all
 * 5xx server errors. Auth failures, validation errors and other 4xx codes
 * are surfaced unchanged so the operator can see the real misconfiguration.
 */
function isProviderFailoverError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  const message = error.message.toLowerCase();
  if (message.includes("429") || message.includes("rate limit") || message.includes("quota")) {
    return true;
  }
  if (/(\b5\d\d\b)/.test(message)) return true;
  if (message.includes("econnreset") || message.includes("etimedout") || message.includes("network")) return true;
  return false;
}

export async function translateTexts(
  input: TranslateTextsInput,
  env: TranslationEnv = process.env,
  settings?: TranslationSettingsLike | null
): Promise<TranslationResult[]> {
  const primary = resolveTranslationProviderConfig({ settings, env });
  const chain = buildFallbackProviderChain(primary, env);

  let lastError: unknown = null;
  for (let index = 0; index < chain.length; index += 1) {
    const candidate = chain[index];
    try {
      return await translateWithProvider(input, env, candidate);
    } catch (error) {
      lastError = error;
      const hasNext = index < chain.length - 1;
      if (!hasNext || !isProviderFailoverError(error)) {
        throw error;
      }
      console.warn(
        `[translation] provider ${candidate.provider} failed (${error instanceof Error ? error.message.slice(0, 120) : String(error)}); falling back to ${chain[index + 1].provider}.`
      );
    }
  }

  // Should never reach here because chain has at least one entry.
  throw lastError instanceof Error ? lastError : new Error("Translation pipeline produced no result");
}
