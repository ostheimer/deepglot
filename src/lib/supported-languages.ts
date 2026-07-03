/**
 * Canonical supported-translation-language list (#123).
 *
 * This is the single source of truth for "which languages does Deepglot
 * support?" — the public endpoints (`GET /api/public/languages`,
 * `GET /api/public/languages/is-supported`) and any marketing/docs claim
 * must derive from here, never from a hand-maintained copy (the two routes
 * previously carried duplicated lists that could drift apart, and the
 * dashboard EU picker offered hr/ga/mt while the public endpoint rejected
 * them).
 *
 * Two tiers:
 *  - `sharedAcrossProviders: true` — the ISO 639-1 subset every configurable
 *    provider can serve, including the narrowest (DeepL-class) providers.
 *  - `sharedAcrossProviders: false` — offered by the product (default
 *    LLM providers handle them fine) but not guaranteed when an organization
 *    pins a narrow provider.
 *
 * The dashboard language picker (EU_LANGUAGE_CODES in language-names.ts)
 * must always stay within the full list.
 */

export type SupportedTranslationLanguage = {
  code: string;
  local_name: string;
  english_name: string;
  /** Serveable by every configurable provider, including the narrowest. */
  sharedAcrossProviders: boolean;
};

export const SUPPORTED_TRANSLATION_LANGUAGES: readonly SupportedTranslationLanguage[] = [
  { code: "ar", local_name: "العربية‏", english_name: "Arabic", sharedAcrossProviders: true },
  { code: "bg", local_name: "български", english_name: "Bulgarian", sharedAcrossProviders: true },
  { code: "cs", local_name: "čeština", english_name: "Czech", sharedAcrossProviders: true },
  { code: "da", local_name: "dansk", english_name: "Danish", sharedAcrossProviders: true },
  { code: "de", local_name: "Deutsch", english_name: "German", sharedAcrossProviders: true },
  { code: "el", local_name: "ελληνικά", english_name: "Greek", sharedAcrossProviders: true },
  { code: "en", local_name: "English", english_name: "English", sharedAcrossProviders: true },
  { code: "es", local_name: "español", english_name: "Spanish", sharedAcrossProviders: true },
  { code: "et", local_name: "eesti", english_name: "Estonian", sharedAcrossProviders: true },
  { code: "fi", local_name: "suomi", english_name: "Finnish", sharedAcrossProviders: true },
  { code: "fr", local_name: "français", english_name: "French", sharedAcrossProviders: true },
  { code: "ga", local_name: "Gaeilge", english_name: "Irish", sharedAcrossProviders: false },
  { code: "hr", local_name: "hrvatski", english_name: "Croatian", sharedAcrossProviders: false },
  { code: "hu", local_name: "magyar", english_name: "Hungarian", sharedAcrossProviders: true },
  { code: "id", local_name: "Bahasa Indonesia", english_name: "Indonesian", sharedAcrossProviders: true },
  { code: "it", local_name: "italiano", english_name: "Italian", sharedAcrossProviders: true },
  { code: "ja", local_name: "日本語", english_name: "Japanese", sharedAcrossProviders: true },
  { code: "ko", local_name: "한국어", english_name: "Korean", sharedAcrossProviders: true },
  { code: "lt", local_name: "lietuvių", english_name: "Lithuanian", sharedAcrossProviders: true },
  { code: "lv", local_name: "latviešu", english_name: "Latvian", sharedAcrossProviders: true },
  { code: "mt", local_name: "Malti", english_name: "Maltese", sharedAcrossProviders: false },
  { code: "nb", local_name: "norsk", english_name: "Norwegian", sharedAcrossProviders: true },
  { code: "nl", local_name: "Nederlands", english_name: "Dutch", sharedAcrossProviders: true },
  { code: "pl", local_name: "polski", english_name: "Polish", sharedAcrossProviders: true },
  { code: "pt", local_name: "português", english_name: "Portuguese", sharedAcrossProviders: true },
  { code: "ro", local_name: "română", english_name: "Romanian", sharedAcrossProviders: true },
  { code: "ru", local_name: "русский", english_name: "Russian", sharedAcrossProviders: true },
  { code: "sk", local_name: "slovenčina", english_name: "Slovak", sharedAcrossProviders: true },
  { code: "sl", local_name: "slovenščina", english_name: "Slovenian", sharedAcrossProviders: true },
  { code: "sv", local_name: "svenska", english_name: "Swedish", sharedAcrossProviders: true },
  { code: "tr", local_name: "Türkçe", english_name: "Turkish", sharedAcrossProviders: true },
  { code: "uk", local_name: "українська", english_name: "Ukrainian", sharedAcrossProviders: true },
  { code: "zh", local_name: "中文", english_name: "Chinese", sharedAcrossProviders: true },
];

export const SUPPORTED_TRANSLATION_LANGUAGE_CODES: ReadonlySet<string> = new Set(
  SUPPORTED_TRANSLATION_LANGUAGES.map((language) => language.code)
);

/** Codes every configurable provider can serve (the cross-provider guarantee). */
export const SHARED_PROVIDER_LANGUAGE_CODES: ReadonlySet<string> = new Set(
  SUPPORTED_TRANSLATION_LANGUAGES.filter((language) => language.sharedAcrossProviders).map(
    (language) => language.code
  )
);

export function isSupportedTranslationLanguage(code: string): boolean {
  return SUPPORTED_TRANSLATION_LANGUAGE_CODES.has(code.toLowerCase());
}

/** A pair is translatable when both codes are supported and differ. */
export function isSupportedTranslationPair(langFrom: string, langTo: string): boolean {
  const from = langFrom.toLowerCase();
  const to = langTo.toLowerCase();

  return (
    from !== to &&
    SUPPORTED_TRANSLATION_LANGUAGE_CODES.has(from) &&
    SUPPORTED_TRANSLATION_LANGUAGE_CODES.has(to)
  );
}
