import type { SiteLocale } from "@/lib/site-locale";

const LANGUAGE_LABELS = {
  en: {
    en: "English",
    de: "German",
    fr: "French",
    es: "Spanish",
    it: "Italian",
    nl: "Dutch",
    pl: "Polish",
    pt: "Portuguese",
    ru: "Russian",
    zh: "Chinese",
    ja: "Japanese",
    ar: "Arabic",
    tr: "Turkish",
    sv: "Swedish",
    da: "Danish",
    fi: "Finnish",
    no: "Norwegian",
    cs: "Czech",
    hu: "Hungarian",
    ro: "Romanian",
    sk: "Slovak",
    hr: "Croatian",
  },
  de: {
    en: "Englisch",
    de: "Deutsch",
    fr: "Französisch",
    es: "Spanisch",
    it: "Italienisch",
    nl: "Niederländisch",
    pl: "Polnisch",
    pt: "Portugiesisch",
    ru: "Russisch",
    zh: "Chinesisch",
    ja: "Japanisch",
    ar: "Arabisch",
    tr: "Türkisch",
    sv: "Schwedisch",
    da: "Dänisch",
    fi: "Finnisch",
    no: "Norwegisch",
    cs: "Tschechisch",
    hu: "Ungarisch",
    ro: "Rumänisch",
    sk: "Slowakisch",
    hr: "Kroatisch",
  },
} as const;

export function getLanguageName(code: string, locale: SiteLocale) {
  return LANGUAGE_LABELS[locale][code as keyof typeof LANGUAGE_LABELS.en] ?? code.toUpperCase();
}

export function getPopularLanguageOptions(locale: SiteLocale) {
  return [
    "en",
    "fr",
    "es",
    "it",
    "nl",
    "pl",
    "pt",
    "ru",
    "zh",
    "ja",
    "ar",
    "tr",
  ].map((code) => ({ code, name: getLanguageName(code, locale) }));
}
