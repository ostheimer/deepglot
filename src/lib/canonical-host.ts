export const CANONICAL_APP_HOST = "deepglot.ai";
const REDIRECT_HOSTS = new Set(["www.deepglot.ai"]);

function normalizeHost(host: string | null | undefined) {
  return host?.split(":")[0]?.trim().toLowerCase() ?? "";
}

export function getCanonicalHostRedirectUrl(
  requestUrl: URL,
  hostHeader: string | null | undefined
) {
  const host = normalizeHost(hostHeader || requestUrl.host);

  if (!REDIRECT_HOSTS.has(host)) {
    return null;
  }

  const redirectUrl = new URL(requestUrl);
  redirectUrl.protocol = "https:";
  redirectUrl.hostname = CANONICAL_APP_HOST;
  redirectUrl.port = "";

  return redirectUrl;
}
