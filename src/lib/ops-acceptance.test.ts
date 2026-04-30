import assert from "node:assert/strict";
import test from "node:test";

import {
  buildNeonRestoreDrillBranchName,
  getNeonRestoreDrillValidation,
} from "@/lib/neon-restore-drill";
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
