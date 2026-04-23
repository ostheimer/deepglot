import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

import {
  isWebhookProcessRequestAuthorized,
  WEBHOOK_PROCESS_CRON_PATH,
  WEBHOOK_PROCESS_CRON_SCHEDULE,
} from "@/lib/webhook-cron";

function cronRequest(url: string, headers: Record<string, string> = {}) {
  return {
    url,
    headers: new Headers(headers),
  };
}

test("authorizes Vercel cron requests with CRON_SECRET bearer token", () => {
  const request = cronRequest("https://deepglot.example/api/webhooks/process", {
    authorization: "Bearer test-secret",
  });

  assert.equal(
    isWebhookProcessRequestAuthorized(request, {
      CRON_SECRET: "test-secret",
      NODE_ENV: "production",
    }),
    true
  );
});

test("rejects production cron requests without bearer authorization", () => {
  const env = { CRON_SECRET: "test-secret", NODE_ENV: "production" };

  assert.equal(
    isWebhookProcessRequestAuthorized(
      cronRequest("https://deepglot.example/api/webhooks/process"),
      env
    ),
    false
  );
  assert.equal(
    isWebhookProcessRequestAuthorized(
      cronRequest("https://deepglot.example/api/webhooks/process", {
        "x-cron-secret": "test-secret",
      }),
      env
    ),
    false
  );
  assert.equal(
    isWebhookProcessRequestAuthorized(
      cronRequest(
        "https://deepglot.example/api/webhooks/process?secret=test-secret"
      ),
      env
    ),
    false
  );
});

test("keeps unauthenticated local cron requests available without CRON_SECRET", () => {
  assert.equal(
    isWebhookProcessRequestAuthorized(
      cronRequest("http://localhost:3000/api/webhooks/process"),
      { NODE_ENV: "development" }
    ),
    true
  );
  assert.equal(
    isWebhookProcessRequestAuthorized(
      cronRequest("http://localhost:3000/api/webhooks/process"),
      { NODE_ENV: "test" }
    ),
    true
  );
});

test("rejects production cron requests when CRON_SECRET is missing", () => {
  assert.equal(
    isWebhookProcessRequestAuthorized(
      cronRequest("https://deepglot.example/api/webhooks/process"),
      { NODE_ENV: "production" }
    ),
    false
  );
});

test("keeps legacy secret transports available outside production", () => {
  const env = { CRON_SECRET: "test-secret", NODE_ENV: "test" };

  assert.equal(
    isWebhookProcessRequestAuthorized(
      cronRequest("http://localhost:3000/api/webhooks/process", {
        "x-cron-secret": "test-secret",
      }),
      env
    ),
    true
  );
  assert.equal(
    isWebhookProcessRequestAuthorized(
      cronRequest(
        "http://localhost:3000/api/webhooks/process?secret=test-secret"
      ),
      env
    ),
    true
  );
});

test("schedules the webhook processor in vercel.json", () => {
  const vercelConfigPath = path.join(process.cwd(), "vercel.json");
  const vercelConfig = JSON.parse(fs.readFileSync(vercelConfigPath, "utf8"));

  assert.deepEqual(vercelConfig.crons, [
    {
      path: WEBHOOK_PROCESS_CRON_PATH,
      schedule: WEBHOOK_PROCESS_CRON_SCHEDULE,
    },
  ]);
});
