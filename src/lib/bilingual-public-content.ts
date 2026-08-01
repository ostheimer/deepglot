import type { SiteLocale } from "@/lib/site-locale";

export const BILINGUAL_PUBLIC_LOCALES = ["en", "de"] as const satisfies readonly SiteLocale[];

export type BilingualPublicLocale = (typeof BILINGUAL_PUBLIC_LOCALES)[number];

export function isBilingualPublicLocale(
  locale: SiteLocale
): locale is BilingualPublicLocale {
  return BILINGUAL_PUBLIC_LOCALES.some((value) => value === locale);
}

export function getBilingualPublicLocale(
  locale: SiteLocale
): BilingualPublicLocale {
  return locale === "de" ? "de" : "en";
}
