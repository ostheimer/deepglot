import type { MetadataRoute } from "next";

import {
  DEFAULT_MARKETING_LOCALE,
  getMarketingPath,
  isSiteLocale,
  type SiteLocale,
} from "@/lib/site-locale";

export const MANIFEST_LOCALE_PARAM = "locale";

export function getManifestLocale(
  value: string | null,
  cookieValue: string | null = null
): SiteLocale {
  if (isSiteLocale(value)) {
    return value;
  }

  return isSiteLocale(cookieValue) ? cookieValue : DEFAULT_MARKETING_LOCALE;
}

export function getManifestHref(locale: SiteLocale): string {
  return `/manifest.webmanifest?${MANIFEST_LOCALE_PARAM}=${locale}`;
}

export function buildLocalizedManifest(locale: SiteLocale): MetadataRoute.Manifest {
  return {
    id: "/",
    name: "Deepglot",
    short_name: "Deepglot",
    description:
      "Open-source WordPress translation without subscription lock-in.",
    start_url: getMarketingPath(locale, "home"),
    scope: "/",
    display: "standalone",
    background_color: "#fbfaf7",
    theme_color: "#f03b22",
    icons: [
      {
        src: "/marketing/deepglot-icon-192.png",
        sizes: "192x192",
        type: "image/png",
        purpose: "any",
      },
      {
        src: "/icon.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "any",
      },
      {
        src: "/marketing/deepglot-icon-maskable.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "maskable",
      },
    ],
  };
}
