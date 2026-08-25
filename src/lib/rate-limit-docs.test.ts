import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";

const ROOT = process.cwd();

function read(relativePath: string) {
  return readFileSync(path.join(ROOT, relativePath), "utf8");
}

test("operations runbook documents the unchanged evidence-gated velocity policy", () => {
  const operations = read("OPERATIONS.md");

  for (const required of [
    "10% of the effective monthly word quota",
    "minimum of 1,000",
    "translate_velocity_reservation",
    "allowed`, `blocked`, or `oversize",
    "No historical outcome classification exists before this rollout",
    "Do not change the threshold",
    "never mutates a new or expired bucket",
    "HMAC pseudonyms",
    "retryProtection",
    "requestPseudonym",
    "rather than `unavailable`",
    "3,600 seconds",
    "422",
    "velocity_request_too_large",
    "no `Retry-After`",
    "retryable 429",
    "Idempotency-Key",
    "Individually oversized fresh-word requests are the 422 exception",
    "active 429 marker",
    "already-due warmer run",
    "configuration-bound HMAC fingerprint",
    "No raw translation text, API key, or URL",
    "API key or backend changes",
    "automatically splits a multi-text 422 batch",
    "existing six-batch run budget",
    "only a text that still returns 422 alone",
  ]) {
    assert.ok(operations.includes(required), `Operations runbook omits: ${required}`);
  }
  assert.doesNotMatch(operations, /\*\*Default:\*\* 50,000 words\/hour\/org/);
});

test("repository and public developer docs distinguish retryable 429 from permanent oversize", () => {
  const publicDocs = read("README.md");
  const developerDocs = read("src/components/marketing/developer-docs.tsx");

  assert.match(publicDocs, /single fresh-word request that exceeds the complete hourly cap/);
  assert.match(publicDocs, /does not reserve or mutate a velocity bucket/);
  assert.match(publicDocs, /Retry-After/);
  assert.match(publicDocs, /clients must wait/i);
  assert.match(publicDocs, /422 velocity_request_too_large/);
  assert.match(publicDocs, /no Retry-After/i);
  assert.match(publicDocs, /retryable 429[^\n]*Idempotency-Key/i);
  assert.match(publicDocs, /keyed HMAC pseudonyms/);
  assert.doesNotMatch(publicDocs, /raw IDs, text, keys, and URLs are logged/);

  assert.match(developerDocs, /422 velocity_request_too_large/);
  assert.match(developerDocs, /retryable 429 responses are not retained by Idempotency-Key/i);
  assert.match(developerDocs, /wiederholbare 429-Antworten[^\n]*Idempotency-Key/i);
  assert.match(developerDocs, /split[^\n]*PDF/i);
});

test("operator docs retain velocity spend after provider dispatch", () => {
  const docs = [read("README.md"), read("OPERATIONS.md")];

  for (const source of docs) {
    assert.match(
      source,
      /Only the final pre-provider configuration gate may release an exact API reservation/i,
    );
    assert.match(
      source,
      /Once a provider call starts, both API and PDF translation retain the reservation conservatively/i,
    );
    assert.doesNotMatch(source, /the API refunds its velocity reservation/i);
    assert.doesNotMatch(source, /for (?:velocity )?refunds, persistence/i);
  }
});

test("bilingual help and its visual explain the bounded queue backoff", () => {
  const help = read("src/components/marketing/help-page.tsx");

  assert.match(help, /id="rate-limit-backoff"/);
  assert.match(help, /Respecting a 429 without a retry storm/);
  assert.match(help, /429 ohne Wiederholungsschleife beachten/);
  assert.match(help, /1 bis 3\.600 Sekunden/);
  assert.match(help, /1 to 3,600 seconds/);
  assert.match(help, /velocity_request_too_large/);
  assert.match(help, /nicht wiederholbar/);
  assert.match(help, /not retryable/);
  assert.match(help, /PDF/);
  assert.match(help, /Mit einem Idempotency-Key teilen gleichzeitige Aufrufe/);
  assert.match(help, /With an Idempotency-Key, concurrent calls share/);
  assert.match(help, /data-testid="rate-limit-backoff-flow"/);
  assert.match(help, /grid gap-4 md:grid-cols-3/);
  assert.match(help, /längste Wartezeit/);
  assert.match(help, /keeps the longest delay/);
  assert.match(help, /aktiver 429-Marker[^"]*Editor- und E-Mail-Aufrufe[^"]*fällige Warmup-Läufe/i);
  assert.match(help, /active 429 marker[^"]*editor and email calls[^"]*due warm-up runs/i);
  assert.match(help, /bis zu einer Stunde[^"]*konfigurationsgebundenen HMAC-Fingerabdruck/i);
  assert.match(help, /up to one hour[^"]*configuration-bound HMAC fingerprint/i);
  assert.match(help, /keine Rohtexte, API-Schlüssel oder URLs/i);
  assert.match(help, /no raw text, API keys, or URLs/i);
  assert.match(help, /normale folgende Stapel/i);
  assert.match(help, /normal following batches/i);
  assert.match(help, /Schlüssel- oder Backendwechsel/i);
  assert.match(help, /key or backend change/i);
  assert.match(help, /WordPress-Warmer[^\"]*mehrteiligen 422-Stapel[^\"]*automatisch/i);
  assert.match(help, /WordPress warmer[^\"]*multi-text 422 batch[^\"]*automatically/i);
  assert.match(help, /einzeln zu großer Text[^\"]*einer Stunde/i);
  assert.match(help, /text that is still too large alone[^\"]*one hour/i);
  assert.match(help, /API-Anfragen und PDFs[^\"]*kleiner teilen/i);
  assert.match(help, /API requests and PDFs[^\"]*split/i);
});

test("public WordPress copy sets accurate Retry-After expectations", () => {
  const developerReadme = read("wordpress-plugin/deepglot/README.md");
  const directoryReadme = read("wordpress-plugin/deepglot/readme.txt");

  for (const source of [developerReadme, directoryReadme]) {
    assert.match(source, /Retry-After/);
    assert.match(source, /one hour/i);
    assert.match(source, /422 velocity_request_too_large/i);
    assert.match(source, /does not schedule/i);
    assert.match(source, /source language/i);
    assert.match(source, /active 429 marker/i);
    assert.match(source, /synchronous visual-editor and WooCommerce email calls/i);
    assert.match(source, /already-due warmer runs/i);
    assert.match(source, /configuration-bound HMAC fingerprint/i);
    assert.match(source, /one hour/i);
    assert.match(source, /no raw translation text, API key, or URL/i);
    assert.match(source, /normal following batches/i);
    assert.match(source, /API key or backend change/i);
    assert.match(source, /automatically splits a multi-text 422 batch/i);
    assert.match(source, /six-batch run budget/i);
    assert.match(source, /only a text that still returns 422 alone/i);
    assert.match(source, /API requests and PDFs.*split/i);
  }
  assert.match(directoryReadme, /stops the remaining sequential batches/i);
  assert.match(developerReadme, /does not immediately retry failed visitor-facing work/i);
});

test("WordPress docs bind translation backoff to the configuration that received the 429", () => {
  const operations = read("OPERATIONS.md");
  const help = read("src/components/marketing/help-page.tsx");
  const developerDocs = read("src/components/marketing/developer-docs.tsx");
  const pluginDocs = [
    read("wordpress-plugin/deepglot/README.md"),
    read("wordpress-plugin/deepglot/readme.txt"),
  ];

  assert.match(operations, /Only translation 429 responses set the active marker/i);
  assert.match(operations, /marker and warmer backoff are bound to the API key and backend/i);
  assert.match(operations, /Configuration changes, late responses from the previous configuration, and legacy or unbound markers do not block new translations/i);

  assert.match(help, /Nur Translation-429-Antworten setzen den aktiven Marker/);
  assert.match(help, /Marker und Warmer-Wartezustand sind an API-Schlüssel und Backend gebunden/);
  assert.match(help, /Konfigurationswechsel, verspätete Antworten der alten Konfiguration und alte ungebundene Marker blockieren keine neuen Übersetzungen/);
  assert.match(help, /Only translation 429 responses set the active marker/i);
  assert.match(help, /marker and warmer backoff are bound to the API key and backend/i);
  assert.match(help, /Configuration changes, late responses from the previous configuration, and legacy or unbound markers do not block new translations/i);

  for (const source of pluginDocs) {
    assert.match(source, /Only translation 429 responses set the active marker/i);
    assert.match(source, /marker and warmer backoff are bound to the API key and backend/i);
    assert.match(source, /Configuration changes, late responses from the previous configuration, and legacy or unbound markers do not block new translations/i);
  }

  assert.match(developerDocs, /Nur Translation-429-Antworten setzen den aktiven Marker/);
  assert.match(developerDocs, /Only translation 429 responses set the active marker/i);
});

test("WordPress docs distinguish tracked 422 split shapes from blocked singletons", () => {
  const operations = read("OPERATIONS.md");
  const help = read("src/components/marketing/help-page.tsx");
  const pluginDocs = [
    read("wordpress-plugin/deepglot/README.md"),
    read("wordpress-plugin/deepglot/readme.txt"),
  ];

  assert.match(operations, /Every 422 batch shape is tracked for up to one hour by a configuration-bound HMAC fingerprint to drive bounded splitting/i);
  assert.match(operations, /Only a text that still returns 422 alone is blocked from automatic resend/i);
  assert.match(operations, /No raw translation text, API key, or URL/i);

  assert.match(help, /Jede 422-Stapelform[^"]*bis zu einer Stunde[^"]*konfigurationsgebundenen HMAC-Fingerabdruck[^"]*begrenzte Aufteilung/i);
  assert.match(help, /Nur ein Text, der allein weiterhin 422 liefert,[^"]*von automatischen Wiederholungen ausgeschlossen/i);
  assert.match(help, /Every 422 batch shape[^"]*up to one hour[^"]*configuration-bound HMAC fingerprint[^"]*bounded splitting/i);
  assert.match(help, /Only a text that still returns 422 alone[^"]*blocked from automatic resend/i);
  assert.doesNotMatch(help, /nur ein einzeln zu großer Text bleibt markiert/i);
  assert.doesNotMatch(help, /only a text still too large alone remains marked/i);

  for (const source of pluginDocs) {
    assert.match(source, /Every 422 batch shape is tracked for up to one hour by a configuration-bound HMAC fingerprint to drive bounded splitting/i);
    assert.match(source, /Only a text that still returns 422 alone is blocked from automatic resend/i);
    assert.match(source, /no raw translation text, API key, or URL/i);
  }
});
