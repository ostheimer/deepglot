import { buildLocalizedManifest } from "@/app/manifest";
import { isSiteLocale } from "@/lib/site-locale";

type ManifestRouteContext = {
  params: Promise<{ manifestLocale: string }>;
};

export async function GET(_request: Request, { params }: ManifestRouteContext) {
  const { manifestLocale } = await params;

  if (!isSiteLocale(manifestLocale)) {
    return new Response("Not Found", { status: 404 });
  }

  return new Response(JSON.stringify(buildLocalizedManifest(manifestLocale)), {
    headers: {
      "cache-control": "public, max-age=0, must-revalidate",
      "content-type": "application/manifest+json",
    },
  });
}
