import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const config = JSON.parse(readFileSync("vercel.json", "utf8"));

test("Vercel functions run beside the verified Frankfurt Neon database", () => {
  assert.deepEqual(config.regions, ["fra1"]);
});

test("the region review branch cannot trigger an automatic deployment", () => {
  assert.deepEqual(config.git?.deploymentEnabled, {
    "codex/deepglot-region-fra1-20261020": false,
  });
});

test("the region change preserves the existing build policy and cron schedules", () => {
  const { regions: _regions, git: _git, ...unchanged } = config;
  void _regions;
  void _git;
  assert.deepEqual(unchanged, {
    $schema: "https://openapi.vercel.sh/vercel.json",
    ignoreCommand: "node scripts/vercel-ignore-build.mjs",
    crons: [
      { path: "/api/webhooks/process", schedule: "*/15 * * * *" },
      { path: "/api/cron/auto-upgrade", schedule: "*/15 * * * *" },
      { path: "/api/cron/activity-digest", schedule: "0 8 * * 1" },
      { path: "/api/cron/page-view-retention", schedule: "17 3 * * *" },
    ],
  });
});
