export type CronAuthEnv = {
  CRON_SECRET?: string;
  NODE_ENV?: string;
};

export type CronRequest = {
  headers: Pick<Headers, "get">;
  url: string;
};

/**
 * Vercel sends CRON_SECRET as a bearer token. Legacy query/header transports
 * stay available for local acceptance scripts, but are never accepted in
 * production.
 */
export function isCronRequestAuthorized(
  request: CronRequest,
  env: CronAuthEnv = process.env
) {
  const configuredSecret = env.CRON_SECRET?.trim();
  const isProduction = env.NODE_ENV === "production";

  if (!configuredSecret) {
    return !isProduction;
  }

  const authHeader = request.headers.get("authorization");

  if (authHeader === `Bearer ${configuredSecret}`) {
    return true;
  }

  if (isProduction) {
    return false;
  }

  const headerSecret = request.headers.get("x-cron-secret");
  const querySecret = new URL(request.url).searchParams.get("secret");

  return [headerSecret, querySecret].includes(configuredSecret);
}
