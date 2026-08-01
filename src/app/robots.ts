import type { MetadataRoute } from "next";

import { CANONICAL_APP_HOST } from "@/lib/canonical-host";

export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: "*",
      allow: "/",
      disallow: [
        "/api/",
        "/dashboard",
        "/projects/",
        "/subscription/",
        "/settings",
      ],
    },
    sitemap: `https://${CANONICAL_APP_HOST}/sitemap.xml`,
    host: `https://${CANONICAL_APP_HOST}`,
  };
}
