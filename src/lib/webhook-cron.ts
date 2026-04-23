export const WEBHOOK_PROCESS_CRON_PATH = "/api/webhooks/process";
export const WEBHOOK_PROCESS_CRON_SCHEDULE = "*/5 * * * *";

type WebhookCronAuthEnv = {
  CRON_SECRET?: string;
  NODE_ENV?: string;
};

type WebhookCronRequest = {
  headers: Pick<Headers, "get">;
  url: string;
};

export function isWebhookProcessRequestAuthorized(
  request: WebhookCronRequest,
  env: WebhookCronAuthEnv = process.env
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
