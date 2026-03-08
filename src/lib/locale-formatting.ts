import { de, enUS } from "date-fns/locale";

import type { SiteLocale } from "@/lib/site-locale";

export function getIntlLocale(locale: SiteLocale) {
  return locale === "de" ? "de-DE" : "en-US";
}

export function formatNumber(value: number, locale: SiteLocale) {
  return value.toLocaleString(getIntlLocale(locale));
}

export function getDateFnsLocale(locale: SiteLocale) {
  return locale === "de" ? de : enUS;
}
