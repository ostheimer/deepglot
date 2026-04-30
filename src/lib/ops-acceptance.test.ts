import assert from "node:assert/strict";
import test from "node:test";

import {
  buildAcceptanceReport,
  getAcceptanceExitCode,
  renderAcceptanceJunit,
  summarizeAcceptanceReport,
} from "@/lib/acceptance-report";
import {
  buildNeonRestoreDrillBranchName,
  getNeonRestoreDrillValidation,
} from "@/lib/neon-restore-drill";
import {
  buildNeonLiveReadinessCheck,
  buildRateLimitReadinessCheck,
  buildStripeReadinessCheck,
  buildWebhookProcessorReadinessCheck,
  redactAcceptanceOutput,
} from "@/lib/production-acceptance";
import { validateStripeAcceptanceConfig } from "@/lib/stripe-acceptance";

test("builds deterministic Neon restore-drill branch names", () => {
  assert.equal(
    buildNeonRestoreDrillBranchName(new Date("2026-04-30T19:08:09.000Z")),
    "restore-drill-prod-20260430190809"
  );
});

test("validates Neon restore-drill inputs before live branch creation", () => {
  assert.deepEqual(
    getNeonRestoreDrillValidation({
      env: {},
      create: true,
      sourceBranch: "prod",
      branchName: "restore-drill-prod-20260430190809",
    }).errors,
    ["NEON_API_KEY is required when creating a restore-drill branch."]
  );

  assert.deepEqual(
    getNeonRestoreDrillValidation({
      env: { NEON_API_KEY: "neon_test" },
      create: true,
      sourceBranch: "prod",
      branchName: "bad branch name",
    }).errors,
    ["Branch name may contain only letters, numbers, dots, underscores, and hyphens."]
  );
});

test("accepts dry-run Neon restore-drill checks without live credentials", () => {
  assert.deepEqual(
    getNeonRestoreDrillValidation({
      env: {},
      create: false,
      sourceBranch: "prod",
      branchName: "restore-drill-prod-20260430190809",
    }).errors,
    []
  );
});

test("validates Stripe live-mode configuration without creating charges", () => {
  const result = validateStripeAcceptanceConfig({
    mode: "live",
    env: {
      STRIPE_SECRET_KEY: "sk_test_123",
      NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY: "pk_live_123",
      STRIPE_WEBHOOK_SECRET: "whsec_123",
      STRIPE_PRICE_STARTER_MONTHLY: "price_starter",
      STRIPE_PRICE_PROFESSIONAL_MONTHLY: "price_professional",
      STRIPE_PRICE_ENTERPRISE_MONTHLY: "price_enterprise",
    },
  });

  assert.deepEqual(result.errors, [
    "STRIPE_SECRET_KEY must start with sk_live_ for live acceptance.",
  ]);
});

test("passes Stripe env-only validation when key modes and price IDs align", () => {
  const result = validateStripeAcceptanceConfig({
    mode: "test",
    env: {
      STRIPE_SECRET_KEY: "sk_test_123",
      NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY: "pk_test_123",
      STRIPE_WEBHOOK_SECRET: "whsec_123",
      STRIPE_PRICE_STARTER_MONTHLY: "price_starter",
      STRIPE_PRICE_PROFESSIONAL_MONTHLY: "price_professional",
      STRIPE_PRICE_ENTERPRISE_MONTHLY: "price_enterprise",
    },
  });

  assert.deepEqual(result.errors, []);
  assert.equal(result.expectedLivemode, false);
});

test("summarizes acceptance reports and treats blocked checks as non-fatal by default", () => {
  const report = buildAcceptanceReport({
    name: "acceptance",
    now: new Date("2026-05-01T00:00:00.000Z"),
    checks: [
      { name: "smoke", status: "PASS", detail: "ok" },
      { name: "stripe", status: "BLOCKED", detail: "missing live keys" },
    ],
  });

  assert.deepEqual(summarizeAcceptanceReport(report), {
    total: 2,
    passed: 1,
    failed: 0,
    blocked: 1,
    skipped: 0,
  });
  assert.equal(getAcceptanceExitCode(report), 0);
  assert.equal(getAcceptanceExitCode(report, true), 1);
});

test("renders blocked acceptance checks as skipped JUnit cases", () => {
  const report = buildAcceptanceReport({
    name: "acceptance & ops",
    now: new Date("2026-05-01T00:00:00.000Z"),
    checks: [{ name: "stripe <live>", status: "BLOCKED", detail: "missing key" }],
  });
  const junit = renderAcceptanceJunit(report);

  assert.match(junit, /tests="1"/);
  assert.match(junit, /failures="0"/);
  assert.match(junit, /skipped="1"/);
  assert.match(junit, /stripe &lt;live&gt;/);
});

test("redacts secrets from acceptance command output", () => {
  assert.equal(
    redactAcceptanceOutput(
      "sk_live_secret pk_test_secret whsec_secret Bearer abc123 postgresql://user:pass@host/db"
    ),
    "sk_live_[redacted] pk_test_[redacted] whsec_[redacted] Bearer [redacted] postgresql://[redacted]"
  );
});

test("builds production acceptance readiness checks without live provider calls", () => {
  assert.deepEqual(buildNeonLiveReadinessCheck({}).status, "BLOCKED");
  assert.deepEqual(
    buildStripeReadinessCheck({
      mode: "live",
      env: {
        STRIPE_SECRET_KEY: "sk_live_123",
        NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY: "pk_live_123",
        STRIPE_WEBHOOK_SECRET: "whsec_123",
        STRIPE_PRICE_STARTER_MONTHLY: "price_starter",
        STRIPE_PRICE_PROFESSIONAL_MONTHLY: "price_professional",
        STRIPE_PRICE_ENTERPRISE_MONTHLY: "price_enterprise",
      },
    }).status,
    "PASS"
  );
  assert.equal(buildRateLimitReadinessCheck({}).status, "PASS");
  assert.equal(
    buildWebhookProcessorReadinessCheck({ runRequested: false }).status,
    "BLOCKED"
  );
  assert.equal(
    buildWebhookProcessorReadinessCheck({
      cronSecret: "secret",
      runRequested: true,
    }).status,
    "PASS"
  );
});
