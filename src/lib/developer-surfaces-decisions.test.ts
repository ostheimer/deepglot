import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";

const decision = readFileSync(
  path.join(process.cwd(), "docs/product-decisions/developer-surfaces.md"),
  "utf8"
);

test("records explicit build/defer decisions for all developer-surface explorations", () => {
  assert.match(decision, /#167:[\s\S]*Decision: \*\*defer\*\*/);
  assert.match(decision, /#168:[\s\S]*Decision: \*\*defer both the SDK and CLI\*\*/);
  assert.match(decision, /#169:[\s\S]*Decision: \*\*defer\*\*/);
  assert.match(decision, /#172:[\s\S]*Decision: \*\*later; strategically relevant only after validation\*\*/);
});

test("pins the required DPP product brief and prevents premature compliance claims", () => {
  for (const required of [
    "First user segment",
    "First surface",
    "Non-goals",
    "GS1 Digital Link",
    "restricted product-passport data",
    "must not describe Deepglot as DPP-compliant",
    "#158",
    "#166",
    "#168",
    "#167",
  ]) {
    assert.ok(decision.includes(required), `DPP decision is missing: ${required}`);
  }
});

test("defines permission, secret, confirmation, and anti-drift checks for future skills", () => {
  const checklist = decision.slice(decision.indexOf("Future skill review checklist:"));
  for (const required of [
    "automated contract or anti-drift test",
    "no real secrets",
    "explicit confirmation",
    "active task context",
    "support status",
  ]) {
    assert.ok(checklist.includes(required), `Skill checklist is missing: ${required}`);
  }
});
