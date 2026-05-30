import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
  blocksNewCheckoutForExistingSubscription,
  getBillingPortalReturnUrl,
  isRealStripeCustomerId,
} from "@/lib/billing";

function restoreEnv(
  authUrl: string | undefined,
  appUrl: string | undefined,
  vercel: string | undefined,
  vercelEnv: string | undefined,
  vercelBranchUrl: string | undefined,
  vercelUrl: string | undefined,
  vercelProductionUrl: string | undefined
): void {
  if (typeof authUrl === "undefined") {
    delete process.env.AUTH_URL;
  } else {
    process.env.AUTH_URL = authUrl;
  }

  if (typeof appUrl === "undefined") {
    delete process.env.NEXT_PUBLIC_APP_URL;
  } else {
    process.env.NEXT_PUBLIC_APP_URL = appUrl;
  }

  if (typeof vercel === "undefined") {
    delete process.env.VERCEL;
  } else {
    process.env.VERCEL = vercel;
  }

  if (typeof vercelEnv === "undefined") {
    delete process.env.VERCEL_ENV;
  } else {
    process.env.VERCEL_ENV = vercelEnv;
  }

  if (typeof vercelBranchUrl === "undefined") {
    delete process.env.VERCEL_BRANCH_URL;
  } else {
    process.env.VERCEL_BRANCH_URL = vercelBranchUrl;
  }

  if (typeof vercelUrl === "undefined") {
    delete process.env.VERCEL_URL;
  } else {
    process.env.VERCEL_URL = vercelUrl;
  }

  if (typeof vercelProductionUrl === "undefined") {
    delete process.env.VERCEL_PROJECT_PRODUCTION_URL;
  } else {
    process.env.VERCEL_PROJECT_PRODUCTION_URL = vercelProductionUrl;
  }
}

test("uses AUTH_URL for the billing portal return URL", () => {
  const originalAuthUrl = process.env.AUTH_URL;
  const originalAppUrl = process.env.NEXT_PUBLIC_APP_URL;
  const originalVercel = process.env.VERCEL;
  const originalVercelEnv = process.env.VERCEL_ENV;
  const originalVercelBranchUrl = process.env.VERCEL_BRANCH_URL;
  const originalVercelUrl = process.env.VERCEL_URL;
  const originalVercelProductionUrl = process.env.VERCEL_PROJECT_PRODUCTION_URL;

  try {
    process.env.AUTH_URL = "https://auth.deepglot.test";
    process.env.NEXT_PUBLIC_APP_URL = "https://app.deepglot.test";

    assert.equal(
      getBillingPortalReturnUrl(),
      "https://auth.deepglot.test/subscription/billing"
    );
  } finally {
    restoreEnv(
      originalAuthUrl,
      originalAppUrl,
      originalVercel,
      originalVercelEnv,
      originalVercelBranchUrl,
      originalVercelUrl,
      originalVercelProductionUrl
    );
  }
});

test("falls back to NEXT_PUBLIC_APP_URL when AUTH_URL is missing", () => {
  const originalAuthUrl = process.env.AUTH_URL;
  const originalAppUrl = process.env.NEXT_PUBLIC_APP_URL;
  const originalVercel = process.env.VERCEL;
  const originalVercelEnv = process.env.VERCEL_ENV;
  const originalVercelBranchUrl = process.env.VERCEL_BRANCH_URL;
  const originalVercelUrl = process.env.VERCEL_URL;
  const originalVercelProductionUrl = process.env.VERCEL_PROJECT_PRODUCTION_URL;

  try {
    delete process.env.AUTH_URL;
    process.env.NEXT_PUBLIC_APP_URL = "https://app.deepglot.test";

    assert.equal(
      getBillingPortalReturnUrl(),
      "https://app.deepglot.test/subscription/billing"
    );
  } finally {
    restoreEnv(
      originalAuthUrl,
      originalAppUrl,
      originalVercel,
      originalVercelEnv,
      originalVercelBranchUrl,
      originalVercelUrl,
      originalVercelProductionUrl
    );
  }
});

test("falls back to Vercel preview system URLs when explicit app URLs are missing", () => {
  const originalAuthUrl = process.env.AUTH_URL;
  const originalAppUrl = process.env.NEXT_PUBLIC_APP_URL;
  const originalVercel = process.env.VERCEL;
  const originalVercelEnv = process.env.VERCEL_ENV;
  const originalVercelBranchUrl = process.env.VERCEL_BRANCH_URL;
  const originalVercelUrl = process.env.VERCEL_URL;
  const originalVercelProductionUrl = process.env.VERCEL_PROJECT_PRODUCTION_URL;

  try {
    delete process.env.AUTH_URL;
    delete process.env.NEXT_PUBLIC_APP_URL;
    process.env.VERCEL = "1";
    process.env.VERCEL_ENV = "preview";
    process.env.VERCEL_BRANCH_URL = "deepglot-git-preview.vercel.app";

    assert.equal(
      getBillingPortalReturnUrl(),
      "https://deepglot-git-preview.vercel.app/subscription/billing"
    );
  } finally {
    restoreEnv(
      originalAuthUrl,
      originalAppUrl,
      originalVercel,
      originalVercelEnv,
      originalVercelBranchUrl,
      originalVercelUrl,
      originalVercelProductionUrl
    );
  }
});

test("falls back to the Vercel production URL in production deployments", () => {
  const originalAuthUrl = process.env.AUTH_URL;
  const originalAppUrl = process.env.NEXT_PUBLIC_APP_URL;
  const originalVercel = process.env.VERCEL;
  const originalVercelEnv = process.env.VERCEL_ENV;
  const originalVercelBranchUrl = process.env.VERCEL_BRANCH_URL;
  const originalVercelUrl = process.env.VERCEL_URL;
  const originalVercelProductionUrl = process.env.VERCEL_PROJECT_PRODUCTION_URL;

  try {
    delete process.env.AUTH_URL;
    delete process.env.NEXT_PUBLIC_APP_URL;
    process.env.VERCEL = "1";
    process.env.VERCEL_ENV = "production";
    process.env.VERCEL_PROJECT_PRODUCTION_URL = "deepglot.com";

    assert.equal(
      getBillingPortalReturnUrl(),
      "https://deepglot.com/subscription/billing"
    );
  } finally {
    restoreEnv(
      originalAuthUrl,
      originalAppUrl,
      originalVercel,
      originalVercelEnv,
      originalVercelBranchUrl,
      originalVercelUrl,
      originalVercelProductionUrl
    );
  }
});

test("throws a clear error when no billing portal base URL is configured", () => {
  const originalAuthUrl = process.env.AUTH_URL;
  const originalAppUrl = process.env.NEXT_PUBLIC_APP_URL;
  const originalVercel = process.env.VERCEL;
  const originalVercelEnv = process.env.VERCEL_ENV;
  const originalVercelBranchUrl = process.env.VERCEL_BRANCH_URL;
  const originalVercelUrl = process.env.VERCEL_URL;
  const originalVercelProductionUrl = process.env.VERCEL_PROJECT_PRODUCTION_URL;

  try {
    delete process.env.AUTH_URL;
    delete process.env.NEXT_PUBLIC_APP_URL;
    delete process.env.VERCEL;
    delete process.env.VERCEL_ENV;
    delete process.env.VERCEL_BRANCH_URL;
    delete process.env.VERCEL_URL;
    delete process.env.VERCEL_PROJECT_PRODUCTION_URL;

    assert.throws(() => getBillingPortalReturnUrl(), {
      message:
        "Missing AUTH_URL, NEXT_PUBLIC_APP_URL, or Vercel system URL for billing redirect URLs.",
    });
  } finally {
    restoreEnv(
      originalAuthUrl,
      originalAppUrl,
      originalVercel,
      originalVercelEnv,
      originalVercelBranchUrl,
      originalVercelUrl,
      originalVercelProductionUrl
    );
  }
});

test("isRealStripeCustomerId allowlists only cus_ prefixes", () => {
  // Real Stripe customer ids.
  assert.equal(isRealStripeCustomerId("cus_PJ8q4xQH6tOKpz"), true);
  assert.equal(isRealStripeCustomerId("cus_"), true); // boundary: prefix-only

  // Internal placeholders written by the app — must NOT be treated as Stripe
  // customers, otherwise /api/billing/portal calls Stripe with a synthetic id
  // and Stripe answers 404 `resource_missing`, surfacing as a confusing
  // "billing portal unavailable" toast on /subscription/overview.
  assert.equal(isRealStripeCustomerId("free_clxxxxxxxxxxxxxxxxxx"), false);
  assert.equal(
    isRealStripeCustomerId("manual_cmoby1nwu0000687hig18thlb"),
    false
  );

  // Missing values must default to "not a real customer" so callers can
  // short-circuit instead of erroring on null access downstream.
  assert.equal(isRealStripeCustomerId(null), false);
  assert.equal(isRealStripeCustomerId(undefined), false);
  assert.equal(isRealStripeCustomerId(""), false);

  // Defence in depth: anything that isn't `cus_…` is rejected, even if it
  // looks vaguely Stripe-ish. This keeps the allowlist tight against future
  // placeholder conventions.
  assert.equal(isRealStripeCustomerId("Cus_PJ8q4xQH6tOKpz"), false);
  assert.equal(isRealStripeCustomerId(" cus_PJ8q4xQH6tOKpz"), false);
  assert.equal(isRealStripeCustomerId("price_1TWwm0FAiA6nPZ"), false);
});

test("blocksNewCheckoutForExistingSubscription blocks ACTIVE, TRIALING, and PAST_DUE with a Stripe subscription id", () => {
  const subId = "sub_123";

  assert.equal(
    blocksNewCheckoutForExistingSubscription({
      stripeSubscriptionId: subId,
      status: "ACTIVE",
    }),
    true
  );
  assert.equal(
    blocksNewCheckoutForExistingSubscription({
      stripeSubscriptionId: subId,
      status: "TRIALING",
    }),
    true
  );
  assert.equal(
    blocksNewCheckoutForExistingSubscription({
      stripeSubscriptionId: subId,
      status: "PAST_DUE",
    }),
    true
  );
});

test("blocksNewCheckoutForExistingSubscription allows Checkout after cancel or without a subscription id", () => {
  assert.equal(blocksNewCheckoutForExistingSubscription(null), false);
  assert.equal(blocksNewCheckoutForExistingSubscription(undefined), false);
  assert.equal(
    blocksNewCheckoutForExistingSubscription({
      stripeSubscriptionId: null,
      status: "ACTIVE",
    }),
    false
  );
  assert.equal(
    blocksNewCheckoutForExistingSubscription({
      stripeSubscriptionId: "sub_old",
      status: "CANCELED",
    }),
    false
  );
  assert.equal(
    blocksNewCheckoutForExistingSubscription({
      stripeSubscriptionId: "sub_old",
      status: "INACTIVE",
    }),
    false
  );
});

test("checkout route uses blocksNewCheckoutForExistingSubscription for duplicate-subscription guard", () => {
  const checkoutRoute = readFileSync(
    "src/app/api/billing/checkout/route.ts",
    "utf8"
  );

  assert.match(checkoutRoute, /blocksNewCheckoutForExistingSubscription/);
  assert.doesNotMatch(
    checkoutRoute,
    /existingSubscription\.status === "ACTIVE"\s*\|\|\s*existingSubscription\.status === "TRIALING"/
  );
});

test("Stripe customer API call sites guard internal placeholder customer ids", () => {
  const cardAndInvoicesPage = readFileSync(
    "src/app/(dashboard)/abonnement/karte-rechnungen/page.tsx",
    "utf8"
  );
  const billingAddressRoute = readFileSync(
    "src/app/api/billing/address/route.ts",
    "utf8"
  );

  assert.match(cardAndInvoicesPage, /isRealStripeCustomerId/);
  assert.doesNotMatch(
    cardAndInvoicesPage,
    /const stripeCustomerId: string \| null = sub\?\.stripeCustomerId \?\? null;/
  );

  assert.match(billingAddressRoute, /isRealStripeCustomerId/);
  assert.doesNotMatch(
    billingAddressRoute,
    /const customerId = membership\?\.organization\?\.subscription\?\.stripeCustomerId;\s+if \(!customerId\)/
  );
});
