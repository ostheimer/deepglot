import { SITE_LOCALE_METADATA, type SiteLocale } from "@/lib/site-locale";

export const EU_LANGUAGE_CODES = [
  "bg",
  "hr",
  "cs",
  "da",
  "nl",
  "en",
  "et",
  "fi",
  "fr",
  "de",
  "el",
  "hu",
  "ga",
  "it",
  "lv",
  "lt",
  "mt",
  "pl",
  "pt",
  "ro",
  "sk",
  "sl",
  "es",
  "sv",
] as const;

export function getLanguageName(code: string, locale: SiteLocale) {
  try {
    const names = new Intl.DisplayNames([SITE_LOCALE_METADATA[locale].intlLocale], {
      type: "language",
    });
    return names.of(code) ?? code.toUpperCase();
  } catch {
    return code.toUpperCase();
  }
}

export function getPopularLanguageOptions(locale: SiteLocale) {
  return EU_LANGUAGE_CODES.map((code) => ({
    code,
    name: getLanguageName(code, locale),
  }));
}
