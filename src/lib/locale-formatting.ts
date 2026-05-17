import {
  bg,
  cs,
  da,
  de,
  el,
  enUS,
  es,
  et,
  fi,
  fr,
  hr,
  hu,
  it,
  lt,
  lv,
  mt,
  nl,
  pl,
  pt,
  ro,
  sk,
  sl,
  sv,
} from "date-fns/locale";

import { SITE_LOCALE_METADATA, type SiteLocale } from "@/lib/site-locale";

const DATE_FNS_LOCALES = {
  bg,
  hr,
  cs,
  da,
  nl,
  en: enUS,
  et,
  fi,
  fr,
  de,
  el,
  hu,
  ga: enUS,
  it,
  lv,
  lt,
  mt,
  pl,
  pt,
  ro,
  sk,
  sl,
  es,
  sv,
} as const;

export function getIntlLocale(locale: SiteLocale) {
  return SITE_LOCALE_METADATA[locale].intlLocale;
}

export function formatNumber(value: number, locale: SiteLocale) {
  return value.toLocaleString(getIntlLocale(locale));
}

export function getDateFnsLocale(locale: SiteLocale) {
  return DATE_FNS_LOCALES[locale] ?? enUS;
}
