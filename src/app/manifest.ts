import type { MetadataRoute } from "next";

import { getCookieLocale } from "@/lib/request-locale";
import { getMarketingPath, type SiteLocale } from "@/lib/site-locale";

export function buildLocalizedManifest(locale: SiteLocale): MetadataRoute.Manifest {
  return {
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

export default async function manifest(): Promise<MetadataRoute.Manifest> {
  return buildLocalizedManifest(await getCookieLocale());
}
