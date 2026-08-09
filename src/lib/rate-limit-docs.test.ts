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
  ]) {
    assert.ok(operations.includes(required), `Operations runbook omits: ${required}`);
  }
  assert.doesNotMatch(operations, /\*\*Default:\*\* 50,000 words\/hour\/org/);
});

test("developer docs describe 429 hard-cap and Retry-After behavior without overclaiming", () => {
  const publicDocs = read("README.md");

  assert.match(publicDocs, /single fresh-word request that exceeds the complete hourly cap/);
  assert.match(publicDocs, /does not reserve or mutate a velocity bucket/);
  assert.match(publicDocs, /Retry-After/);
  assert.match(publicDocs, /clients must wait/i);
  assert.match(publicDocs, /keyed HMAC pseudonyms/);
  assert.doesNotMatch(publicDocs, /raw IDs, text, keys, and URLs are logged/);
});

test("bilingual help and its visual explain the bounded queue backoff", () => {
  const help = read("src/components/marketing/help-page.tsx");

  assert.match(help, /id="rate-limit-backoff"/);
  assert.match(help, /Respecting a 429 without a retry storm/);
  assert.match(help, /429 ohne Wiederholungsschleife beachten/);
  assert.match(help, /1 bis 300 Sekunden/);
  assert.match(help, /1 to 300 seconds/);
  assert.match(help, /data-testid="rate-limit-backoff-flow"/);
  assert.match(help, /grid gap-4 md:grid-cols-3/);
  assert.match(help, /längste Wartezeit/);
  assert.match(help, /keeps the longest delay/);
});

test("public WordPress copy sets accurate Retry-After expectations", () => {
  const developerReadme = read("wordpress-plugin/deepglot/README.md");
  const directoryReadme = read("wordpress-plugin/deepglot/readme.txt");

  for (const source of [developerReadme, directoryReadme]) {
    assert.match(source, /Retry-After/);
    assert.match(source, /five minutes|fünf Minuten/i);
    assert.match(source, /source language/i);
  }
  assert.match(directoryReadme, /stops the remaining sequential batches/i);
  assert.match(developerReadme, /does not immediately retry failed visitor-facing work/i);
});
