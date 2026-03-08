export type TranslationResult = {
  detectedSourceLanguage?: string;
  text: string;
};

export type TranslateTextsInput = {
  texts: string[];
  sourceLang: string;
  targetLang: string;
};

export type TranslationProviderName = "deepl" | "openai" | "mock";

export type TranslationEnv = Record<string, string | undefined>;

export function countWords(text: string): number {
  return text.trim().split(/\s+/).filter(Boolean).length;
}
