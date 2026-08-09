import {
  isCronRequestAuthorized,
  type CronAuthEnv,
  type CronRequest,
} from "@/lib/cron-auth";

export const ACTIVITY_DIGEST_CRON_PATH = "/api/cron/activity-digest";
export const ACTIVITY_DIGEST_CRON_SCHEDULE = "0 8 * * 1";

export function isActivityDigestRequestAuthorized(
  request: CronRequest,
  env: CronAuthEnv = process.env
) {
  return isCronRequestAuthorized(request, env);
}
