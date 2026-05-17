import { cookies, headers } from "next/headers";

import {
  DEFAULT_MARKETING_LOCALE,
  SITE_LOCALE_COOKIE,
  isSiteLocale,
  type SiteLocale,
} from "@/lib/site-locale";

type SearchParamsLike = Record<string, string | string[] | undefined>;

export type LocaleSearchParams = SearchParamsLike | Promise<SearchParamsLike>;

export async function getRequestLocale(): Promise<SiteLocale> {
  const cookieLocale = (await cookies()).get(SITE_LOCALE_COOKIE)?.value;
  if (isSiteLocale(cookieLocale)) {
    return cookieLocale;
  }

  const headerLocale = (await headers()).get("x-deepglot-locale");
  return isSiteLocale(headerLocale) ? headerLocale : DEFAULT_MARKETING_LOCALE;
}

export async function getCookieLocale(): Promise<SiteLocale> {
  const value = (await cookies()).get(SITE_LOCALE_COOKIE)?.value;
  return isSiteLocale(value) ? value : DEFAULT_MARKETING_LOCALE;
}

export async function getPageLocale(
  searchParams?: LocaleSearchParams
): Promise<SiteLocale> {
  if (searchParams) {
    const resolved = await searchParams;
    const rawLocale = resolved.__locale;
    const locale = Array.isArray(rawLocale) ? rawLocale[0] : rawLocale;

    if (isSiteLocale(locale)) {
      return locale;
    }
  }

  return getRequestLocale();
}
