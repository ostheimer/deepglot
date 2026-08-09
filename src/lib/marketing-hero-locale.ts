import { SITE_LOCALES, type SiteLocale } from "@/lib/site-locale";
import { uiText } from "@/lib/static-copy";

export function getMarketingHeroLocale(locale: SiteLocale) {
  return {
    eyebrow: `${uiText(locale, "Austria")} · ${SITE_LOCALES.length} ${uiText(
      locale,
      "Languages"
    )} · Open Source`,
  };
}
