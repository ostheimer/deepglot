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
import {
  TranslationProviderResponseError,
  type TranslateTextsInput,
  type TranslationEnv,
  type TranslationProviderName,
  type TranslationResult,
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
 * Errors the fallback wrapper treats as "try the next provider": invalid
 * provider response contracts, quota / rate-limit responses, gateway/timeout
 * errors and catch-all 5xx server errors. Auth failures, local configuration
 * errors and other 4xx codes are surfaced unchanged so the operator can see
 * the real misconfiguration.
 */
const RETRYABLE_TRANSPORT_ERROR_CODES = new Set([
  "EAI_AGAIN",
  "ECONNREFUSED",
  "ECONNRESET",
  "ENETUNREACH",
  "ENOTFOUND",
  "EPIPE",
  "ETIMEDOUT",
  "UND_ERR_BODY_TIMEOUT",
  "UND_ERR_CONNECT_TIMEOUT",
  "UND_ERR_HEADERS_TIMEOUT",
]);

function isProviderFailoverError(error: unknown): boolean {
  if (error instanceof TranslationProviderResponseError) return true;
  if (!(error instanceof Error)) return false;

  if (error.name === "AbortError" || error.name === "TimeoutError") {
    return true;
  }

  let cause: unknown = (error as Error & { cause?: unknown }).cause;
  for (let depth = 0; cause && depth < 3; depth += 1) {
    if (typeof cause !== "object") break;

    const code = (cause as { code?: unknown }).code;
    if (
      typeof code === "string" &&
      RETRYABLE_TRANSPORT_ERROR_CODES.has(code.toUpperCase())
    ) {
      return true;
    }

    if (cause instanceof Error) {
      if (cause.name === "AbortError" || cause.name === "TimeoutError") {
        return true;
      }
      cause = (cause as Error & { cause?: unknown }).cause;
      continue;
    }
    break;
  }

  const message = error.message.toLowerCase();
  if (
    message.includes("408") ||
    message.includes("429") ||
    message.includes("rate limit") ||
    message.includes("quota")
  ) {
    return true;
  }
  if (/(\b5\d\d\b)/.test(message)) return true;
  if (
    message.includes("fetch failed") ||
    message.includes("econnreset") ||
    message.includes("etimedout") ||
    message.includes("network")
  ) {
    return true;
  }
  return false;
}

/**
 * Upper bound on how much of an upstream provider error we copy into a log
 * line. Provider errors embed the raw API response body (see openai.ts /
 * gemini.ts), so they can be long — but truncating to a too-small window
 * (the previous limit was 120 chars) hid the HTTP status and detail that make
 * an outage diagnosable. 500 keeps the status + reason without dumping an
 * entire response envelope into the logs.
 */
const PROVIDER_ERROR_LOG_LIMIT = 500;

function describeProviderError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return message.length > PROVIDER_ERROR_LOG_LIMIT
    ? `${message.slice(0, PROVIDER_ERROR_LOG_LIMIT)}...`
    : message;
}

export async function translateTexts(
  input: TranslateTextsInput,
  env: TranslationEnv = process.env,
  settings?: TranslationSettingsLike | null
): Promise<TranslationResult[]> {
  const primary = resolveTranslationProviderConfig({ settings, env });
  const chain = buildFallbackProviderChain(primary, env);
  const providerChain = chain.map((entry) => entry.provider).join(" -> ");

  let lastError: unknown = null;
  for (let index = 0; index < chain.length; index += 1) {
    const candidate = chain[index];
    try {
      return await translateWithProvider(input, env, candidate);
    } catch (error) {
      lastError = error;
      const hasNext = index < chain.length - 1;

      // Recoverable provider response / quota / rate-limit / 5xx / network
      // error with another provider still to try: warn rather than error — the
      // request can still succeed via the fallback — but log the full upstream
      // detail and the chain so a recurring failover is visible.
      if (hasNext && isProviderFailoverError(error)) {
        console.warn(
          `[translation] provider ${candidate.provider} failed; falling back to ${chain[index + 1].provider} (chain: ${providerChain}). ${describeProviderError(error)}`
        );
        continue;
      }

      // Terminal failure: either the last provider in the chain failed, or the
      // error is one we deliberately surface to the operator (auth / bad
      // request). This is what the caller turns into a 5xx, so log it at error
      // level with the failing provider, the full message and the attempted
      // chain — the previous code logged nothing here and left only the route's
      // generic "[/api/translate] Fehler" line.
      console.error(
        `[translation] translation failed via ${candidate.provider}${
          hasNext ? " (non-failover error, not retrying)" : " (last provider in chain)"
        } (chain: ${providerChain}). ${describeProviderError(error)}`
      );
      throw error;
    }
  }

  // Unreachable: the chain always contains at least the primary provider.
  console.error(
    `[translation] pipeline produced no result (chain: ${providerChain}).`
  );
  throw lastError instanceof Error
    ? lastError
    : new Error("Translation pipeline produced no result");
}
