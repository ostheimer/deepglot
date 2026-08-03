// DeepL translation provider

import {
  TranslationProviderResponseError,
  type TranslateTextsInput,
  type TranslationEnv,
  type TranslationResult,
} from "@/lib/translation-types";

const DEEPL_API_URL = "https://api-free.deepl.com/v2"; // use api.deepl.com for Pro

export type DeepLLanguage = {
  language: string;
  name: string;
};

/**
 * Translates an array of texts using the DeepL API.
 * Sends a single batch request to minimize latency (same batching strategy as the compatibility layer).
 */
export async function translateWithDeepL(
  { texts, sourceLang, targetLang }: TranslateTextsInput,
  env: TranslationEnv = process.env
): Promise<TranslationResult[]> {
  const apiKey = env.DEEPL_API_KEY;
  if (!apiKey) throw new Error("DEEPL_API_KEY nicht konfiguriert");

  const params = new URLSearchParams();
  params.append("source_lang", sourceLang.toUpperCase());
  params.append("target_lang", targetLang.toUpperCase());
  params.append("preserve_formatting", "1");

  for (const text of texts) {
    params.append("text", text);
  }

  const response = await fetch(`${DEEPL_API_URL}/translate`, {
    method: "POST",
    headers: {
      Authorization: `DeepL-Auth-Key ${apiKey}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: params.toString(),
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`DeepL API Fehler ${response.status}: ${error}`);
  }

  let rawData: unknown;
  try {
    rawData = await response.json();
  } catch {
    throw new TranslationProviderResponseError(
      "DeepL API returned an unparseable JSON envelope."
    );
  }

  if (!rawData || typeof rawData !== "object" || Array.isArray(rawData)) {
    throw new TranslationProviderResponseError(
      "DeepL API returned an invalid response envelope."
    );
  }

  const translations = (rawData as { translations?: unknown }).translations;
  if (!Array.isArray(translations)) {
    throw new TranslationProviderResponseError(
      "DeepL API response did not include a translations array."
    );
  }

  if (translations.length !== texts.length) {
    throw new TranslationProviderResponseError(
      `DeepL returned ${translations.length} instead of ${texts.length} translations.`
    );
  }

  return translations.map((entry, index) => {
    if (
      !entry ||
      typeof entry !== "object" ||
      Array.isArray(entry) ||
      typeof (entry as { text?: unknown }).text !== "string" ||
      (entry as { text: string }).text.trim().length === 0
    ) {
      throw new TranslationProviderResponseError(
        `DeepL returned no valid translation for entry ${index + 1}.`
      );
    }

    const translation = entry as {
      detected_source_language?: unknown;
      text: string;
    };
    const result: TranslationResult = { text: translation.text };

    if (typeof translation.detected_source_language === "string") {
      result.detectedSourceLanguage = translation.detected_source_language;
    }

    return result;
  });
}

/**
 * Fetches the list of supported source languages from DeepL.
 */
export async function getSupportedLanguages(): Promise<DeepLLanguage[]> {
  const apiKey = process.env.DEEPL_API_KEY;
  if (!apiKey) throw new Error("DEEPL_API_KEY nicht konfiguriert");

  const response = await fetch(`${DEEPL_API_URL}/languages?type=source`, {
    headers: { Authorization: `DeepL-Auth-Key ${apiKey}` },
    next: { revalidate: 86400 }, // cache for 24 hours
  });

  if (!response.ok) throw new Error("DeepL Sprachen konnten nicht geladen werden");

  return response.json();
}
