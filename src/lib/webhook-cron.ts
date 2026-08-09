import {
  isCronRequestAuthorized,
  type CronAuthEnv,
  type CronRequest,
} from "@/lib/cron-auth";

export const WEBHOOK_PROCESS_CRON_PATH = "/api/webhooks/process";
export const WEBHOOK_PROCESS_CRON_SCHEDULE = "*/5 * * * *";

export function isWebhookProcessRequestAuthorized(
  request: CronRequest,
  env: CronAuthEnv = process.env
) {
  return isCronRequestAuthorized(request, env);
}
