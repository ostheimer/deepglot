import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";

// Source-level guardrail for the per-project fresh-word velocity limit (#203).
//
// The velocity gate is the authoritative, atomic, per-project bound on fresh
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

function routeSource() {
  return readFileSync(ROUTE_PATH, "utf8");
}

test("translate route enforces the per-project word velocity limit (#203)", () => {
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

test("an over-budget velocity result is rejected with 429 velocity_limited", () => {
  const source = routeSource();

  assert.match(
    source,
    /velocity_limited/,
    "the velocity rejection must carry a velocity_limited code"
  );
  assert.match(
    source,
    /!velocity\.allowed[\s\S]{0,400}status:\s*429/,
    "an over-budget velocity result must return HTTP 429"
  );
});
