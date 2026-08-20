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

test("provider count-mismatch isolation is documented across support surfaces", () => {
  const readme = source("README.md");
  const operations = source("OPERATIONS.md");
  const help = source("src/components/marketing/help-page.tsx");
  const developerDocs = source("src/components/marketing/developer-docs.tsx");
  const pluginReadme = source("wordpress-plugin/deepglot/README.md");
  const wpOrgReadme = source("wordpress-plugin/deepglot/readme.txt");

  for (const documentation of [
    readme,
    operations,
    help,
    developerDocs,
    pluginReadme,
    wpOrgReadme,
  ]) {
    assert.match(documentation, /count mismatch/i);
    assert.match(documentation, /direct singleton isolation/i);
    assert.match(
      documentation,
      /default eight-text chunk with two providers[^.]*18 provider (?:HTTP )?calls/i
    );
    assert.match(
      documentation,
      /provider-call ceiling[^.]*chain length × \(chunk size \+ 1\)/i
    );
    assert.match(
      documentation,
      /request-wide provider-call concurrency cap \(default 12\)/i
    );
    assert.match(
      documentation,
      /(?:finishes all bounded root-chunk attempts before starting singleton|complete the bounded root-chunk phase before any singleton)/i
    );
    assert.match(
      documentation,
      /one global calibration wave containing the first[^.]*real singletons/i
    );
    assert.match(
      documentation,
      /ceil\(remaining singleton texts \/ request-wide concurrency\)[^.]*observed calibration-wave duration/i
    );
    assert.match(
      documentation,
      /cannot fit the remaining request deadline/i
    );
    assert.match(
      documentation,
      /after calibration and before any further singleton call/i
    );
    assert.match(documentation, /same globally bounded singleton queue/i);
    assert.doesNotMatch(documentation, /bounded binary isolation/i);
    assert.doesNotMatch(documentation, /30 provider (?:HTTP )?calls/i);
    assert.doesNotMatch(documentation, /(?:at most|capped at) six provider/i);
    assert.doesNotMatch(documentation, /höchstens sechs Anbieteraufrufe/i);
    assert.match(
      documentation,
      /(?:100-second (?:provider-work )?deadline|provider-work deadline of at most 100 seconds)/i
    );
  }

  assert.match(help, /Abweichung bei der Ergebnisanzahl/);
  assert.match(help, /alle versuchten Anbieter/);
  assert.match(help, /direkte Einzeltext-Isolierung/);
  assert.match(
    help,
    /Standardfall mit acht Texten und zwei Anbietern[^.]*18 Anbieteraufrufe/
  );
  assert.match(help, /anfrageweite Parallelitätsgrenze von standardmäßig 12/);
  assert.match(help, /genau eine globale Kalibrierungswelle/);
  assert.match(help, /gemessene Dauer der Kalibrierungswelle/);
  assert.match(help, /vor jedem weiteren Einzeltextaufruf/);
  assert.match(help, /dieselbe global begrenzte Einzeltextwarteschlange/);
  assert.match(developerDocs, /Ergebnisanzahl/);
  assert.match(developerDocs, /alle versuchten Anbieter/);
  assert.match(developerDocs, /direkte Einzeltext-Isolierung/);
  assert.match(
    developerDocs,
    /Standardfall mit acht Texten und zwei Anbietern[^.]*18 Anbieteraufrufe/
  );
  assert.match(
    developerDocs,
    /anfrageweite Parallelitätsgrenze von standardmäßig 12/
  );
  assert.match(
    developerDocs,
    /genau eine globale Kalibrierungswelle/
  );
  assert.match(developerDocs, /gemessene Dauer der Kalibrierungswelle/);
  assert.match(developerDocs, /vor jedem weiteren Einzeltextaufruf/);
  assert.match(
    developerDocs,
    /dieselbe global begrenzte Einzeltextwarteschlange/
  );
  assert.doesNotMatch(help, /30 Anbieteraufrufe/);
  assert.doesNotMatch(developerDocs, /30 Anbieteraufrufe/);
  assert.match(operations, /never source or translated text, URLs, or credentials/i);
  assert.match(readme, /timeouts, authentication, rate limits, NUL output/i);
});

test("PDF count-mismatch recovery keeps a route-specific provider-work margin", () => {
  const pdfTranslation = source("src/lib/pdf-translation.ts");
  const pdfRoute = source(
    "src/app/api/projects/[projektId]/pdf-translations/route.ts"
  );
  const readme = source("README.md");
  const operations = source("OPERATIONS.md");
  const help = source("src/components/marketing/help-page.tsx");
  const developerDocs = source("src/components/marketing/developer-docs.tsx");
  const envExample = source(".env.example");

  assert.match(pdfRoute, /maxDuration\s*=\s*60/);
  assert.match(
    pdfTranslation,
    /PDF_TRANSLATION_REQUEST_TIMEOUT_MS\s*=\s*40_000/
  );
  assert.match(
    pdfTranslation,
    /maxRequestTimeoutMs:\s*PDF_TRANSLATION_REQUEST_TIMEOUT_MS/
  );

  for (const documentation of [
    readme,
    operations,
    help,
    developerDocs,
    envExample,
  ]) {
    assert.match(documentation, /PDF[^\n]{0,240}40[- ]second/i);
  }
  assert.match(help, /PDF[^\n]{0,240}40 Sekunden/i);
  assert.match(developerDocs, /PDF[^\n]{0,240}40 Sekunden/i);
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

test("operations require public robots verification when a physical file bypasses WordPress", () => {
  const operations = source("OPERATIONS.md");

  assert.match(operations, /physical `robots\.txt`/i);
  assert.match(operations, /bypasses the WordPress `robots_txt` filter/i);
  assert.match(operations, /query-free public `robots\.txt`/i);
  assert.match(operations, /canonical production host/i);
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

test("runbook and handoff retain historical warm-up and current v0.12.1 production evidence", () => {
  const readme = source("README.md");
  const operations = source("OPERATIONS.md");
  const handoff = source("HANDOFF.md");

  for (const documentation of [operations, handoff]) {
    assert.match(documentation, /`cccc9ba`/);
    assert.match(documentation, /warm-up-verified|warm-up acceptance/i);
  }

  assert.match(readme, /commit `3b914007`/);
  assert.match(readme, /deployed on 2026-08-10/);

  assert.match(operations, /synthetic one-shot provider failure/i);
  assert.match(operations, /`blocking=false`, `timeout=0\.01`/);
  assert.match(operations, /temporary public URL returned 404/i);
  assert.match(operations, /\| 50 \| 18,735 ms \| 1,225 ms \| 15\.29× \|/);
  assert.match(operations, /All eight matching `\/api\/translate` requests were HTTP 200/);
  assert.match(operations, /contained four `\/api\/translate` events/);
  assert.match(handoff, /warm-up queues empty, no scheduled warm-up event/);
  assert.match(handoff, /installed 121-file normalized tree is `ba697054/);
  assert.match(handoff, /dynamic-translator\.js\?ver=0\.12\.1/);
  assert.match(handoff, /Vercel Production deployment `dpl_6G1e6hY9H45KKLSnZfLVVUSLHTEK` is `Ready`/);
  assert.match(operations, /accepted ZIP SHA-256 is `56f2bd30/);
  assert.match(operations, /completed in one cron attempt/);
  assert.doesNotMatch(readme, /follow-up warm-up acceptance remains/);
  assert.doesNotMatch(handoff, /warm-up cron\/cache acceptance remains open/);
});
