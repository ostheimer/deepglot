import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";

const decision = readFileSync(
  path.join(process.cwd(), "docs/product-decisions/platform-agnostic.md"),
  "utf8"
);
const normalizedDecision = decision.replace(/\s+/g, " ");

test("records an explicit demand-gated decision for issue #121", () => {
  for (const required of [
    "Issue #121",
    "Decision: **defer implementation**",
    "WordPress-first",
    "Universal JavaScript snippet",
    "Reverse proxy",
    "Translation CDN",
    "must not be advertised as available",
  ]) {
    assert.ok(decision.includes(required), `Decision is missing: ${required}`);
  }
});

test("defines measurable reconsideration and release gates", () => {
  for (const required of [
    "three qualified non-WordPress customers",
    "origin-locked public site token",
    "quota and rate limits",
    "server-rendered crawlable HTML",
    "SSRF",
    "cache invalidation",
    "tenant isolation",
    "load test",
    "security review",
  ]) {
    assert.ok(
      normalizedDecision.includes(required),
      `Release gate is missing: ${required}`
    );
  }
});

test("keeps the strategic deferral consistent with the public product surface", () => {
  const setup = readFileSync(
    path.join(
      process.cwd(),
      "src/app/(dashboard)/projekte/[projektId]/einstellungen/setup/page.tsx"
    ),
    "utf8"
  );
  const docs = readFileSync(
    path.join(process.cwd(), "src/components/marketing/developer-docs.tsx"),
    "utf8"
  );

  assert.match(setup, /not yet available/);
  assert.match(
    docs,
    /Universal JavaScript snippet and reverse proxy are not currently available/
  );
  assert.doesNotMatch(docs, /https?:\/\/cdn\.deepglot\./i);
});
