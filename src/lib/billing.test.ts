import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
  blocksNewCheckoutForExistingSubscription,
  checkoutCompletionIsDuplicate,
  classifyOpenCheckoutSessions,
  customerHasBlockingStripeSubscription,
  getBillingPortalReturnUrl,
  isRealStripeCustomerId,
  stripeSubscriptionStatusBlocksCheckout,
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

test("blocksNewCheckoutForExistingSubscription blocks any live Stripe subscription id except CANCELED", () => {
  const subId = "sub_123";

  for (const status of ["ACTIVE", "TRIALING", "PAST_DUE", "INACTIVE"] as const) {
    assert.equal(
      blocksNewCheckoutForExistingSubscription({
        stripeSubscriptionId: subId,
        status,
      }),
      true,
      `expected block for ${status}`
    );
  }
});

test("blocksNewCheckoutForExistingSubscription allows Checkout only without sub id or after subscription.deleted sync", () => {
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
});

test("cancel route does not mark subscription CANCELED before Stripe ends the period", () => {
  const cancelRoute = readFileSync(
    "src/app/api/billing/cancel/route.ts",
    "utf8"
  );

  assert.match(cancelRoute, /cancel_at_period_end:\s*true/);
  assert.doesNotMatch(
    cancelRoute,
    /data:\s*\{\s*status:\s*"CANCELED"\s*\}/
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

test("stripeSubscriptionStatusBlocksCheckout treats terminal Stripe statuses as safe for new Checkout", () => {
  assert.equal(stripeSubscriptionStatusBlocksCheckout("canceled"), false);
  assert.equal(
    stripeSubscriptionStatusBlocksCheckout("incomplete_expired"),
    false
  );
  assert.equal(stripeSubscriptionStatusBlocksCheckout("active"), true);
  assert.equal(stripeSubscriptionStatusBlocksCheckout("trialing"), true);
  assert.equal(stripeSubscriptionStatusBlocksCheckout("past_due"), true);
  assert.equal(stripeSubscriptionStatusBlocksCheckout("incomplete"), true);
});

test("customerHasBlockingStripeSubscription returns true when Stripe lists a live subscription", async () => {
  const stripeClient = {
    subscriptions: {
      list: async () => ({
        data: [{ id: "sub_1", status: "active" }],
        has_more: false,
      }),
    },
  };

  assert.equal(
    await customerHasBlockingStripeSubscription("cus_test", stripeClient),
    true
  );
});

test("customerHasBlockingStripeSubscription returns false when only canceled subs exist", async () => {
  const stripeClient = {
    subscriptions: {
      list: async () => ({
        data: [
          { id: "sub_1", status: "canceled" },
          { id: "sub_2", status: "incomplete_expired" },
        ],
        has_more: false,
      }),
    },
  };

  assert.equal(
    await customerHasBlockingStripeSubscription("cus_test", stripeClient),
    false
  );
});

test("checkout route queries Stripe for live subscriptions before creating a session", () => {
  const checkoutRoute = readFileSync(
    "src/app/api/billing/checkout/route.ts",
    "utf8"
  );

  assert.match(checkoutRoute, /customerHasBlockingStripeSubscription/);
});

test("customerHasBlockingStripeSubscription pages past the first 100 results", async () => {
  let calls = 0;
  const stripeClient = {
    subscriptions: {
      list: async () => {
        calls += 1;
        if (calls === 1) {
          return {
            data: [{ id: "sub_old", status: "canceled" }],
            has_more: true,
          };
        }
        return {
          data: [{ id: "sub_live", status: "active" }],
          has_more: false,
        };
      },
    },
  };

  assert.equal(
    await customerHasBlockingStripeSubscription("cus_test", stripeClient),
    true
  );
  assert.equal(calls, 2);
});

test("classifyOpenCheckoutSessions reuses the same plan+interval and expires the rest", () => {
  const { reuseUrl, expireIds } = classifyOpenCheckoutSessions(
    [
      { id: "cs_same", url: "https://stripe/cs_same", metadata: { plan: "PRO", interval: "monthly" } },
      { id: "cs_other", url: "https://stripe/cs_other", metadata: { plan: "STARTER", interval: "monthly" } },
      { id: "cs_dupe", url: "https://stripe/cs_dupe", metadata: { plan: "PRO", interval: "monthly" } },
    ],
    "PRO",
    "monthly"
  );
  assert.equal(reuseUrl, "https://stripe/cs_same");
  assert.deepEqual(expireIds, ["cs_other", "cs_dupe"]);
});

test("classifyOpenCheckoutSessions expires all open sessions when none match the selection", () => {
  const { reuseUrl, expireIds } = classifyOpenCheckoutSessions(
    [
      { id: "cs_a", url: "https://stripe/cs_a", metadata: { plan: "STARTER", interval: "monthly" } },
      { id: "cs_b", url: "https://stripe/cs_b", metadata: { plan: "PRO", interval: "yearly" } },
    ],
    "PRO",
    "monthly"
  );
  assert.equal(reuseUrl, null);
  assert.deepEqual(expireIds, ["cs_a", "cs_b"]);
});

test("classifyOpenCheckoutSessions returns nothing to do for an empty list", () => {
  assert.deepEqual(classifyOpenCheckoutSessions([], "PRO", "monthly"), {
    reuseUrl: null,
    expireIds: [],
  });
});

test("checkoutCompletionIsDuplicate flags only a different live subscription", () => {
  assert.equal(checkoutCompletionIsDuplicate(null, "sub_new"), false);
  assert.equal(
    checkoutCompletionIsDuplicate({ stripeSubscriptionId: null, status: "ACTIVE" }, "sub_new"),
    false
  );
  assert.equal(
    checkoutCompletionIsDuplicate({ stripeSubscriptionId: "sub_new", status: "ACTIVE" }, "sub_new"),
    false
  );
  assert.equal(
    checkoutCompletionIsDuplicate({ stripeSubscriptionId: "sub_old", status: "ACTIVE" }, "sub_new"),
    true
  );
  assert.equal(
    checkoutCompletionIsDuplicate({ stripeSubscriptionId: "sub_old", status: "CANCELED" }, "sub_new"),
    false
  );
});

test("checkout route reuses/expires open Checkout sessions before creating one", () => {
  const checkoutRoute = readFileSync(
    "src/app/api/billing/checkout/route.ts",
    "utf8"
  );
  assert.match(checkoutRoute, /classifyOpenCheckoutSessions/);
  assert.match(checkoutRoute, /checkout\.sessions\.list/);
  assert.match(checkoutRoute, /checkout\.sessions\.expire/);
});

test("stripe webhook flags duplicate completed Checkouts", () => {
  const webhookRoute = readFileSync(
    "src/app/api/webhooks/stripe/route.ts",
    "utf8"
  );
  assert.match(webhookRoute, /checkoutCompletionIsDuplicate/);
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
