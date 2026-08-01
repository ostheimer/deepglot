import type { MetadataRoute } from "next";

import { CANONICAL_APP_HOST } from "@/lib/canonical-host";
import { SITE_LOCALES, withLocalePrefix } from "@/lib/site-locale";

const PRIVATE_ROUTE_ROOTS = [
  "/dashboard",
  "/projects",
  "/subscription",
  "/settings",
] as const;

function getPrivateRouteDisallowList() {
  return SITE_LOCALES.flatMap((locale) =>
    PRIVATE_ROUTE_ROOTS.flatMap((path) => {
      const localizedPath = withLocalePrefix(path, locale);
      return [localizedPath, `${localizedPath}/`];
    })
  );
}

export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: "*",
      allow: "/",
      disallow: [
        "/api/",
        ...getPrivateRouteDisallowList(),
      ],
    },
    sitemap: `https://${CANONICAL_APP_HOST}/sitemap.xml`,
    host: `https://${CANONICAL_APP_HOST}`,
  };
}
