import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";

import { BILLING_PLANS } from "@/lib/billing-plans";

// ROADMAP 7.13 — anti-drift guard for the marketing home hero/comparison copy.
//
// PR #38 fixed a hero claim that advertised "EUR 49 / 1M words" while the
// canonical Pro plan said something else: the copy was hardcoded and silently
// drifted when BILLING_PLANS changed. These assertions pin the wiring at the
// source level so Deepglot's own price and word-ceiling claims can only come
// from BILLING_PLANS:
//
//  1. The component must derive its numbers from BILLING_PLANS
//     (imports + the specific derivation expressions).
//  2. Hardcoded "EUR <n>" tokens are only allowed for competitor-comparison
//     copy (explicit allowlist) — and even those must never collide with a
//     current Deepglot monthly price, so a future price change that makes a
//     competitor token ambiguous forces a human review here.
//  3. No string literal may embed a literal word amount ("1M words",
//     "200,000 Wörter", …) — word ceilings render through placeholders
//     filled from BILLING_PLANS at runtime.

const COMPONENT_PATH = path.join(
  process.cwd(),
  "src",
  "components",
  "marketing",
  "marketing-home.tsx"
);

// Competitor-comparison copy: the only hardcoded EUR amounts that may exist.
const ALLOWED_COMPETITOR_EUR_TOKENS = new Set(["EUR 99"]);

function componentSource() {
  return readFileSync(COMPONENT_PATH, "utf8");
}

test("marketing home derives its own price and word claims from BILLING_PLANS (7.13)", () => {
  const source = componentSource();

  assert.match(
    source,
    /import \{[^}]*BILLING_PLANS[^}]*\} from "@\/lib\/billing-plans"/,
    "marketing-home must import BILLING_PLANS"
  );
  assert.match(
    source,
    /BILLING_PLANS\.PRO/,
    "the highlighted plan must be read from BILLING_PLANS.PRO"
  );
  assert.match(
    source,
    /monthlyPriceCents/,
    "the advertised monthly price must derive from monthlyPriceCents"
  );
  assert.match(
    source,
    /BILLING_PLANS\.FREE\.wordsLimit/,
    "the free-tier word claim must derive from BILLING_PLANS.FREE.wordsLimit"
  );
  assert.match(
    source,
    /PRO_PLAN\.wordsLimit|BILLING_PLANS\.PRO\.wordsLimit/,
    "the Pro word ceiling must derive from the Pro plan's wordsLimit"
  );
});

test("hardcoded EUR tokens are competitor-only and never collide with a real plan price (7.13)", () => {
  const source = componentSource();

  const deepglotMonthlyEuros = new Set(
    Object.values(BILLING_PLANS)
      .map((plan) => plan.monthlyPriceCents)
      .filter((cents): cents is number => typeof cents === "number" && cents > 0)
      .map((cents) => `EUR ${Math.round(cents / 100)}`)
  );

  const hardcodedEurTokens = [...source.matchAll(/EUR\s+(\d+)/g)].map(
    (match) => `EUR ${match[1]}`
  );

  const offenders = hardcodedEurTokens.filter(
    (token) => !ALLOWED_COMPETITOR_EUR_TOKENS.has(token)
  );
  assert.deepEqual(
    offenders,
    [],
    "hardcoded EUR amounts outside the competitor allowlist — derive Deepglot prices from BILLING_PLANS instead"
  );

  const collisions = hardcodedEurTokens.filter((token) =>
    deepglotMonthlyEuros.has(token)
  );
  assert.deepEqual(
    collisions,
    [],
    "a hardcoded EUR token now equals a real Deepglot monthly price — re-check whether the copy silently advertises a plan price"
  );
});

test("no string literal embeds a literal word amount (7.13)", () => {
  const source = componentSource();

  const literalWordAmounts = [
    ...source.matchAll(/["'`][^"'`\n]*\b\d[\d.,]*\s*[MK]?\s*(words|Wörter)\b[^"'`\n]*["'`]/gi),
  ].map((match) => match[0]);

  assert.deepEqual(
    literalWordAmounts,
    [],
    "word ceilings must render through placeholders filled from BILLING_PLANS, never as literals"
  );
});
