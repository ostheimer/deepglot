import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

import {
  ACTIVITY_DIGEST_CRON_PATH,
  ACTIVITY_DIGEST_CRON_SCHEDULE,
  isActivityDigestRequestAuthorized,
} from "@/lib/activity-digest-cron";

function cronRequest(url: string, headers: Record<string, string> = {}) {
  return { url, headers: new Headers(headers) };
}

test("authorizes the activity digest cron with the Vercel bearer secret", () => {
  assert.equal(
    isActivityDigestRequestAuthorized(
      cronRequest("https://deepglot.ai/api/cron/activity-digest", {
        authorization: "Bearer test-secret",
      }),
      { CRON_SECRET: "test-secret", NODE_ENV: "production" }
    ),
    true
  );
});

test("rejects unauthenticated production digest requests", () => {
  assert.equal(
    isActivityDigestRequestAuthorized(
      cronRequest("https://deepglot.ai/api/cron/activity-digest"),
      { CRON_SECRET: "test-secret", NODE_ENV: "production" }
    ),
    false
  );
});

test("schedules one weekly activity digest alongside the webhook processor", () => {
  const config = JSON.parse(
    fs.readFileSync(path.join(process.cwd(), "vercel.json"), "utf8")
  ) as { crons: Array<{ path: string; schedule: string }> };

  assert.deepEqual(
    config.crons.find((cron) => cron.path === ACTIVITY_DIGEST_CRON_PATH),
    {
      path: ACTIVITY_DIGEST_CRON_PATH,
      schedule: ACTIVITY_DIGEST_CRON_SCHEDULE,
    }
  );
  assert.equal(
    config.crons.filter((cron) => cron.path === ACTIVITY_DIGEST_CRON_PATH).length,
    1
  );
});
