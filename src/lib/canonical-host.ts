export const CANONICAL_APP_HOST = "deepglot.ai";
const ALWAYS_REDIRECT_HOSTS = new Set(["www.deepglot.ai"]);

type CanonicalRedirectEnv = {
  DEEPGLOT_CANONICAL_REDIRECT_HOSTS?: string;
  VERCEL_ENV?: string;
  VERCEL_URL?: string;
  VERCEL_BRANCH_URL?: string;
  VERCEL_PROJECT_PRODUCTION_URL?: string;
};

function normalizeHost(host: string | null | undefined) {
  return host?.split(":")[0]?.trim().toLowerCase() ?? "";
}

function parseRedirectHosts(value: string | null | undefined) {
  return new Set(
    (value ?? "")
      .split(",")
      .map((host) => normalizeHost(host))
      .filter(Boolean)
  );
}

function getProductionRedirectHosts(env: CanonicalRedirectEnv) {
  if (env.VERCEL_ENV !== "production") {
    return new Set<string>();
  }

  const hosts = parseRedirectHosts(env.DEEPGLOT_CANONICAL_REDIRECT_HOSTS);
  hosts.add(normalizeHost(env.VERCEL_URL));
  hosts.add(normalizeHost(env.VERCEL_BRANCH_URL));

  const productionHost = normalizeHost(env.VERCEL_PROJECT_PRODUCTION_URL);
  if (productionHost) {
    hosts.delete(productionHost);
  }
  hosts.delete(CANONICAL_APP_HOST);

  return hosts;
}

export function getCanonicalHostRedirectUrl(
  requestUrl: URL,
  hostHeader: string | null | undefined,
  env: CanonicalRedirectEnv = process.env as CanonicalRedirectEnv
) {
  const host = normalizeHost(hostHeader || requestUrl.host);
  const redirectHosts = new Set([
    ...ALWAYS_REDIRECT_HOSTS,
    ...getProductionRedirectHosts(env),
  ]);

  if (!redirectHosts.has(host)) {
    return null;
  }

  const redirectUrl = new URL(requestUrl);
  redirectUrl.protocol = "https:";
  redirectUrl.hostname = CANONICAL_APP_HOST;
  redirectUrl.port = "";

  return redirectUrl;
}
