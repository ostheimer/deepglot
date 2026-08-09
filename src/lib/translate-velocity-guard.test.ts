import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";

// Source-level guardrail for the per-org fresh-word velocity limit (#203).
//
// The velocity gate is the authoritative, atomic, per-org bound on fresh
// provider spend — the real fix behind the WordPress plugin's soft per-IP caps
// (v0.8.4). Removing it silently would re-open the quota-drain vector, and the
// route handler is coupled to Prisma/auth so it is not unit-tested directly.
// This asserts the wiring at the source level: the translate route must call
// consumeTranslateWordVelocity, and only for real fresh spend (not bots or
// health probes).

const ROUTE_PATH = path.join(
  process.cwd(),
  "src",
  "app",
  "api",
  "translate",
  "route.ts"
);
const PDF_TRANSLATION_PATH = path.join(
  process.cwd(),
  "src",
  "lib",
  "pdf-translation.ts"
);

function routeSource() {
  return readFileSync(ROUTE_PATH, "utf8");
}

function pdfTranslationSource() {
  return readFileSync(PDF_TRANSLATION_PATH, "utf8");
}

test("translate route enforces the per-org word velocity limit (#203)", () => {
  const source = routeSource();

  assert.match(
    source,
    /consumeTranslateWordVelocity/,
    "the translate route must call consumeTranslateWordVelocity"
  );
  assert.match(
    source,
    /consumeTranslateWordVelocity\(\{[\s\S]*?organizationId:[\s\S]*?words:[\s\S]*?limit:[\s\S]*?\}\)/,
    "velocity must be charged per organization (matching the per-org quota), by word count, against a limit"
  );
});

test("translate route derives the velocity cap from the effective monthly quota (#214)", () => {
  const source = routeSource();

  assert.match(
    source,
    /getTranslateWordVelocityPolicy\(wordsLimit\)/,
    "velocity must derive the threshold and its provenance from the effective monthly wordsLimit"
  );
  assert.doesNotMatch(
    source,
    /limit:\s*getRateLimitConfig\(\)\.translateWordVelocityPerHour/,
    "the translate route must not fall back to the former flat velocity default"
  );
});

test("translate route emits privacy-safe velocity outcome classification before responding", () => {
  const source = routeSource();

  assert.match(
    source,
    /reportTranslateVelocityOutcome\(\s*\{[\s\S]{0,1200}?result:\s*velocity[\s\S]{0,1200}?actorClass:\s*"human"[\s\S]{0,1200}?surface:\s*"translate_api"[\s\S]{0,1200}?organizationId:\s*project\.organizationId[\s\S]{0,1200}?projectId:\s*project\.id[\s\S]{0,1200}?requestFingerprintInput:/,
    "every fresh-word reservation must emit the bounded structured classification"
  );
  assert.match(
    source,
    /reportTranslateVelocityOutcome[\s\S]{0,1800}?if\s*\(\s*!velocity\.allowed\s*\)/,
    "blocked and oversize reservations must be classified before returning 429"
  );
});

test("PDF translations emit the same privacy-safe outcome classification", () => {
  const source = pdfTranslationSource();

  assert.match(
    source,
    /getTranslateWordVelocityPolicy\(wordsLimit\)/,
    "PDF reservations must expose the same threshold provenance"
  );
  assert.match(
    source,
    /reportTranslateVelocityOutcome\(\s*\{[\s\S]{0,1200}?result:\s*velocity[\s\S]{0,1200}?actorClass:\s*"human"[\s\S]{0,1200}?surface:\s*"pdf"[\s\S]{0,1200}?organizationId:\s*project\.organizationId[\s\S]{0,1200}?projectId:\s*project\.id[\s\S]{0,1200}?requestFingerprintInput:/,
    "PDF reservations must contribute to rollout classification"
  );
  assert.match(
    source,
    /reportTranslateVelocityOutcome[\s\S]{0,1800}?if\s*\(\s*!velocity\.allowed\s*\)/,
    "blocked and oversize PDF reservations must be classified before the 429"
  );
});

test("the velocity gate charges every fresh spend but exempts bots — NOT health probes", () => {
  const source = routeSource();

  // The guard condition immediately preceding the velocity call must exclude
  // bots and require fresh words > 0.
  const gate = source.match(
    /if\s*\(\s*([^)]*translatedWords[^)]*)\)\s*\{[\s\S]{0,260}?consumeTranslateWordVelocity/
  );
  assert.ok(gate, "consumeTranslateWordVelocity must sit behind a translatedWords gate");

  const condition = gate[1];
  assert.match(condition, /!isBot/, "bots must be exempt from the velocity limit");
  assert.match(condition, /translatedWords > 0/, "only real fresh spend is charged");
  // quota_probe must NOT gate velocity: it is an attacker-settable body flag
  // and the spend/usage block does not honor it, so exempting velocity would
  // let `quota_probe: true` bypass the limit at full spend.
  assert.doesNotMatch(
    condition,
    /quotaProbe/,
    "velocity must not be conditioned on quota_probe (it is attacker-settable and would bypass the limit)"
  );
});

test("a retryable exhausted window is rejected with 429 velocity_limited", () => {
  const source = routeSource();

  assert.match(
    source,
    /velocity_limited/,
    "the velocity rejection must carry a velocity_limited code"
  );
  assert.match(
    source,
    /velocity\.outcome\s*===\s*"blocked"[\s\S]{0,500}status:\s*429[\s\S]{0,500}code:\s*"velocity_limited"/,
    "only an exhausted fixed window must return the retryable 429 contract"
  );
});

test("an inherently oversized API or PDF request is non-retryable", () => {
  const api = routeSource();
  const pdf = pdfTranslationSource();

  for (const source of [api, pdf]) {
    assert.match(source, /velocity\.outcome\s*===\s*"oversize"/);
    assert.match(source, /velocity_request_too_large/);
    assert.match(source, /status:\s*422|,\s*422,/);
  }
  assert.match(
    api,
    /velocity\.outcome\s*===\s*"oversize"[\s\S]{0,700}velocity_request_too_large/,
  );
  assert.match(
    pdf,
    /velocity\.outcome\s*===\s*"oversize"[\s\S]{0,700}velocity_request_too_large/,
  );
});

test("translate idempotency deduplicates retryable 429 only until its Retry-After window", () => {
  const source = routeSource();

  assert.match(
    source,
    /responseRetentionMs:\s*translateIdempotencyResponseRetentionMs/,
    "the route must keep a retryable 429 only through its Retry-After interval",
  );
  assert.match(
    source,
    /function translateIdempotencyResponseRetentionMs[\s\S]{0,700}?response\.status\s*!==\s*429[\s\S]{0,700}?retry-after/,
  );
  assert.match(
    source,
    /result\.kind\s*===\s*"replayed"[\s\S]{0,700}?reportApiIdempotencyReplay/,
    "replayed retryable outcomes must remain visible through privacy-safe metadata",
  );
});

test("provider failures refund the reserved velocity words before returning 500", () => {
  const source = routeSource();

  assert.match(
    source,
    /releaseTranslateWordVelocity/,
    "the translate route must import and call releaseTranslateWordVelocity"
  );
  assert.match(
    source,
    /catch\s*\([^)]*\)\s*\{[\s\S]{0,600}releaseTranslateWordVelocity[\s\S]{0,600}throw\s+error/,
    "provider errors must refund the velocity reservation before the route rethrows to its 500 handler"
  );
});

test("persistence failures refund the reserved velocity words before returning 500", () => {
  const source = routeSource();

  assert.match(
    source,
    /catch\s*\([^)]*\)\s*\{[\s\S]{0,800}releaseTranslateWordVelocity[\s\S]{0,800}throw\s+error/,
    "persistence errors must refund the velocity reservation before the route rethrows to its 500 handler"
  );
  assert.match(
    source,
    /Velocity refund failed after persistence error/,
    "persistence refund failures must be logged distinctly from provider refund failures"
  );
});
