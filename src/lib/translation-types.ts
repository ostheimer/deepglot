export type TranslationResult = {
  detectedSourceLanguage?: string;
  text: string;
};

/**
 * The provider answered successfully at the HTTP layer, but its payload
 * cannot satisfy the one-result-per-input translation contract.
 *
 * A dedicated type lets the provider chain recover through its configured
 * fallback without treating authentication or local configuration failures
 * as retryable.
 */
export class TranslationProviderResponseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TranslationProviderResponseError";
  }
}

export type TranslateTextsInput = {
  texts: string[];
  sourceLang: string;
  targetLang: string;
};

export type TranslationProviderName =
  | "deepl"
  | "gemini"
  | "mock"
  | "ollama"
  | "openai"
  | "openai-compatible"
  | "openrouter";

export type TranslationEnv = Record<string, string | undefined>;

/**
 * Deadline for a single provider HTTP call.
 *
 * The adapters used to call `fetch` with no timeout at all, so a hung upstream
 * held the serverless function until the platform killed it — three requests
 * hit "Task timed out after 300 seconds" on /api/translate within 24h, and the
 * configured fallback provider never got a turn because the first one never
 * returned. `isProviderFailoverError` already classifies a TimeoutError as
 * recoverable; the deadline is what turns a hang into a failover.
 *
 * 45s sits above the slowest healthy call measured against production (40.5s
 * for an unchunked 50-segment batch; a normal chunk of 8 needs ~16s), so it
 * never aborts a call that would have succeeded. It also keeps a full chain —
 * primary hangs, fallback runs — inside the route's `maxDuration`, which a
 * longer deadline would not: the platform would kill the function before the
 * fallback ever got its turn.
 */
export const DEFAULT_PROVIDER_TIMEOUT_MS = 45_000;

export function resolveProviderTimeoutMs(
  env: TranslationEnv = process.env
): number {
  const parsed = Number.parseInt(
    (env.TRANSLATION_PROVIDER_TIMEOUT_MS ?? "").trim(),
    10
  );

  return Number.isFinite(parsed) && parsed > 0
    ? parsed
    : DEFAULT_PROVIDER_TIMEOUT_MS;
}

/**
 * Signal that aborts a provider call once its deadline passes. Kept in one
 * place so every adapter gets the same behavior — a provider added later
 * without one would silently reintroduce the hang.
 */
export function providerAbortSignal(env: TranslationEnv = process.env): AbortSignal {
  return AbortSignal.timeout(resolveProviderTimeoutMs(env));
}

export function countWords(text: string): number {
  return text.trim().split(/\s+/).filter(Boolean).length;
}
