import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";

const ROOT = process.cwd();

function source(relativePath: string) {
  return readFileSync(path.join(ROOT, relativePath), "utf8");
}

test("README does not claim provider chunking eliminates count mismatches", () => {
  const readme = source("README.md");

  assert.match(readme, /reduces provider payload size and exposure/i);
  assert.match(readme, /does not eliminate provider count mismatches/i);
  assert.doesNotMatch(
    readme,
    /removes the batch-size-driven `returned N instead of M translations` failures/,
  );
});

test("operations document real fresh/cache latency evidence and its write boundary", () => {
  const operations = source("OPERATIONS.md");
  const packageJson = source("package.json");
  const envExample = source(".env.example");
  const latencySection = operations.slice(
    operations.indexOf("### Fresh and cached translation latency"),
    operations.indexOf("## Stripe Acceptance"),
  );

  assert.match(packageJson, /acceptance:translation-latency/);
  assert.match(
    envExample,
    /DEEPGLOT_LATENCY_ACCEPTANCE_APP_URL="https:\/\/deepglot\.ai"/,
  );
  assert.match(envExample, /DEEPGLOT_LATENCY_ACCEPTANCE_API_KEY=""/);
  assert.match(operations, /npm run acceptance:translation-latency/);
  assert.match(operations, /--confirm-write/);
  assert.match(operations, /1, 12, 25, and 50/);
  assert.match(operations, /real translation, cache, usage, and batch-log state/i);
  assert.match(operations, /HTTP 200 alone is not a pass/i);
  assert.match(operations, /provider fallback and timeout logs/i);
  assert.match(operations, /DEEPGLOT_LATENCY_ACCEPTANCE_APP_URL/);
  assert.match(operations, /DEEPGLOT_LATENCY_ACCEPTANCE_API_KEY/);
  assert.match(operations, /exactly `https:\/\/deepglot\.ai`/);
  assert.doesNotMatch(
    latencySection,
    /DEEPGLOT_SAAS_API_KEY|MEINHAUSHALT_PROD_DEEPGLOT_API_KEY/,
  );
});

test("plugin and developer docs pin localized purges, immediate nudges, and WP Super queue draining", () => {
  const pluginReadme = source("wordpress-plugin/deepglot/README.md");
  const wpOrgReadme = source("wordpress-plugin/deepglot/readme.txt");
  const developerDocs = source("src/components/marketing/developer-docs.tsx");
  const operations = source("OPERATIONS.md");

  for (const documentation of [pluginReadme, wpOrgReadme, developerDocs]) {
    assert.match(documentation, /WP Super Cache/);
    assert.match(documentation, /queue (?:has fully drained|is empty)/i);
  }

  assert.match(pluginReadme, /localized public request URL/i);
  assert.match(developerDocs, /lokalisierte öffentliche Anfrage-URL/);
  assert.match(pluginReadme, /at most one non-blocking WP-Cron nudge/i);
  assert.match(wpOrgReadme, /one non-blocking WP-Cron nudge/i);
  assert.match(developerDocs, /one non-blocking WP-Cron nudge per request/i);
  assert.match(operations, /one non-blocking `spawn_cron\(\)` nudge/i);
  assert.match(operations, /DOING_CRON`\/`wp_doing_cron\(\)/);
});

test("bilingual public copy explains the completed-versus-pending cache boundary", () => {
  const help = source("src/components/marketing/help-page.tsx");

  assert.match(help, /id="wordpress-warmup"/);
  assert.match(help, /pending pages stay cached/i);
  assert.match(help, /ausstehende Seiten im Cache bleiben/);
  assert.match(help, /localized URL|lokalisierte URL/);
  assert.match(help, /one non-blocking WP-Cron nudge per request/i);
  assert.match(help, /Sobald Warteschlange und fälliges Ereignis gespeichert sind/);
});

test("runbook and handoff retain the completed v0.12.0 production warm-up evidence", () => {
  const readme = source("README.md");
  const operations = source("OPERATIONS.md");
  const handoff = source("HANDOFF.md");

  for (const documentation of [readme, operations, handoff]) {
    assert.match(documentation, /commit `cccc9ba`/);
    assert.match(documentation, /warm-up-verified|warm-up acceptance/i);
  }

  assert.match(operations, /synthetic one-shot provider failure/i);
  assert.match(operations, /`blocking=false`, `timeout=0\.01`/);
  assert.match(operations, /temporary public URL returned 404/i);
  assert.match(operations, /\| 50 \| 18,735 ms \| 1,225 ms \| 15\.29× \|/);
  assert.match(operations, /All eight matching `\/api\/translate` requests were HTTP 200/);
  assert.match(operations, /contained four `\/api\/translate` events/);
  assert.match(handoff, /installed normalized tree is `644edad/);
  assert.match(handoff, /warm-up queues empty, no scheduled warm-up event/);
  assert.match(handoff, /Vercel Production deployment `dpl_DLwoXpjKFJJ6BpweArYLTMpB2atn` is `Ready`/);
  assert.doesNotMatch(readme, /follow-up warm-up acceptance remains/);
  assert.doesNotMatch(handoff, /warm-up cron\/cache acceptance remains open/);
});
