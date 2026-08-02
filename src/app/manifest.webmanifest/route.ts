import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

import {
  MANIFEST_LOCALE_PARAM,
  buildLocalizedManifest,
  getManifestLocale,
} from "@/lib/manifest";

export const dynamic = "force-dynamic";

export function GET(request: NextRequest) {
  const locale = getManifestLocale(
    request.nextUrl.searchParams.get(MANIFEST_LOCALE_PARAM)
  );

  return new NextResponse(JSON.stringify(buildLocalizedManifest(locale)), {
    headers: {
      "Cache-Control": "public, max-age=0, must-revalidate",
      "Content-Type": "application/manifest+json; charset=utf-8",
    },
  });
}
