import { STATIC_MESSAGES } from "@/lib/static-messages";
import type { SiteLocale } from "@/lib/site-locale";

export type LocalizedRecord<T> = {
  readonly en: T;
} & Partial<Record<SiteLocale, unknown>>;

export function uiText(locale: SiteLocale, english: string, german?: string) {
  if (locale === "en") {
    return english;
  }

  if (locale === "de") {
    return german ?? STATIC_MESSAGES.de?.[english] ?? english;
  }

  return STATIC_MESSAGES[locale]?.[english] ?? english;
}

function shouldSkipCopyTranslation(value: string) {
  return (
    value.startsWith("/") ||
    value.startsWith("#") ||
    value.startsWith("http://") ||
    value.startsWith("https://") ||
    value.startsWith("mailto:")
  );
}

function translateCopyValue(locale: SiteLocale, value: unknown): unknown {
  if (typeof value === "string") {
    if (shouldSkipCopyTranslation(value)) {
      return value;
    }
    return uiText(locale, value);
  }

  if (Array.isArray(value)) {
    return value.map((item) => translateCopyValue(locale, item));
  }

  if (
    value &&
    typeof value === "object" &&
    (Object.getPrototypeOf(value) === Object.prototype ||
      Object.getPrototypeOf(value) === null)
  ) {
    const translated: Record<string, unknown> = {};
    for (const [key, nestedValue] of Object.entries(value)) {
      translated[key] = translateCopyValue(locale, nestedValue);
    }
    return translated;
  }

  return value;
}

export function localizeCopy<T>(
  locale: SiteLocale,
  copy: LocalizedRecord<T>
): T {
  if (locale === "de" && copy.de) {
    return copy.de as T;
  }

  if (locale !== "en" && copy[locale]) {
    return copy[locale] as T;
  }

  if (locale === "en") {
    return copy.en;
  }

  return translateCopyValue(locale, copy.en) as T;
}
