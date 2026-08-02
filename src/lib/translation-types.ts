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

export function countWords(text: string): number {
  return text.trim().split(/\s+/).filter(Boolean).length;
}
