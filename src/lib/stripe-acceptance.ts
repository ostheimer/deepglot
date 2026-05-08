export type StripeAcceptanceMode = "test" | "live";

export type StripeAcceptanceEnv = {
  STRIPE_SECRET_KEY?: string;
  NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY?: string;
  STRIPE_WEBHOOK_SECRET?: string;
  STRIPE_PRICE_STARTER_MONTHLY?: string;
  STRIPE_PRICE_STARTER_YEARLY?: string;
  STRIPE_PRICE_BUSINESS_MONTHLY?: string;
  STRIPE_PRICE_BUSINESS_YEARLY?: string;
  STRIPE_PRICE_PRO_MONTHLY?: string;
  STRIPE_PRICE_PRO_YEARLY?: string;
  STRIPE_PRICE_ADVANCED_MONTHLY?: string;
  STRIPE_PRICE_ADVANCED_YEARLY?: string;
  STRIPE_PRICE_EXTENDED_MONTHLY?: string;
  STRIPE_PRICE_EXTENDED_YEARLY?: string;
};

export type StripeAcceptanceValidationInput = {
  mode: StripeAcceptanceMode;
  env: StripeAcceptanceEnv;
};

/**
 * Every Stripe price id env key the live billing flow depends on. Both the
 * monthly and yearly intervals must be configured so the marketing pricing
 * grid's yearly toggle has a valid Stripe price to point at.
 */
const PRICE_KEYS = [
  "STRIPE_PRICE_STARTER_MONTHLY",
  "STRIPE_PRICE_STARTER_YEARLY",
  "STRIPE_PRICE_BUSINESS_MONTHLY",
  "STRIPE_PRICE_BUSINESS_YEARLY",
  "STRIPE_PRICE_PRO_MONTHLY",
  "STRIPE_PRICE_PRO_YEARLY",
  "STRIPE_PRICE_ADVANCED_MONTHLY",
  "STRIPE_PRICE_ADVANCED_YEARLY",
  "STRIPE_PRICE_EXTENDED_MONTHLY",
  "STRIPE_PRICE_EXTENDED_YEARLY",
] as const;

/**
 * Maps each price-id env key to the Stripe billing interval the product is
 * supposed to advertise. Matches the script that creates the prices.
 */
const PRICE_INTERVAL: Record<(typeof PRICE_KEYS)[number], "month" | "year"> = {
  STRIPE_PRICE_STARTER_MONTHLY: "month",
  STRIPE_PRICE_STARTER_YEARLY: "year",
  STRIPE_PRICE_BUSINESS_MONTHLY: "month",
  STRIPE_PRICE_BUSINESS_YEARLY: "year",
  STRIPE_PRICE_PRO_MONTHLY: "month",
  STRIPE_PRICE_PRO_YEARLY: "year",
  STRIPE_PRICE_ADVANCED_MONTHLY: "month",
  STRIPE_PRICE_ADVANCED_YEARLY: "year",
  STRIPE_PRICE_EXTENDED_MONTHLY: "month",
  STRIPE_PRICE_EXTENDED_YEARLY: "year",
};

export const REQUIRED_STRIPE_WEBHOOK_EVENTS = [
  "checkout.session.completed",
  "invoice.paid",
  "invoice.payment_failed",
  "customer.subscription.deleted",
  "customer.subscription.updated",
] as const;

export function validateStripeAcceptanceConfig({
  mode,
  env,
}: StripeAcceptanceValidationInput) {
  const errors: string[] = [];
  const expectedLivemode = mode === "live";
  // Both the standard secret key (`sk_*`) and a restricted key (`rk_*`) are
  // accepted; restricted keys are recommended for automation because they
  // ship narrower scopes.
  const secretPrefixes = expectedLivemode
    ? ["sk_live_", "rk_live_"]
    : ["sk_test_", "rk_test_"];
  const publishablePrefix = expectedLivemode ? "pk_live_" : "pk_test_";

  if (!env.STRIPE_SECRET_KEY) {
    errors.push("STRIPE_SECRET_KEY is required.");
  } else if (!secretPrefixes.some((prefix) => env.STRIPE_SECRET_KEY!.startsWith(prefix))) {
    errors.push(
      `STRIPE_SECRET_KEY must start with one of ${secretPrefixes.join(", ")} for ${mode} acceptance.`
    );
  }

  if (!env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY) {
    errors.push("NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY is required.");
  } else if (!env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY.startsWith(publishablePrefix)) {
    errors.push(
      `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY must start with ${publishablePrefix} for ${mode} acceptance.`
    );
  }

  if (!env.STRIPE_WEBHOOK_SECRET) {
    errors.push("STRIPE_WEBHOOK_SECRET is required.");
  } else if (!env.STRIPE_WEBHOOK_SECRET.startsWith("whsec_")) {
    errors.push("STRIPE_WEBHOOK_SECRET must start with whsec_.");
  }

  for (const key of PRICE_KEYS) {
    const value = env[key];
    if (!value) {
      errors.push(`${key} is required.`);
    } else if (!value.startsWith("price_")) {
      errors.push(`${key} must be a Stripe price ID starting with price_.`);
    }
  }

  return {
    ok: errors.length === 0,
    errors,
    expectedLivemode,
    priceIds: PRICE_KEYS.map((key) => ({
      key,
      id: env[key] ?? "",
      expectedInterval: PRICE_INTERVAL[key],
    })),
  };
}

export function validateStripePriceResource({
  key,
  id,
  livemode,
  active,
  interval,
  expectedLivemode,
  expectedInterval = "month",
}: {
  key: string;
  id: string;
  livemode: boolean;
  active: boolean;
  interval?: string | null;
  expectedLivemode: boolean;
  expectedInterval?: "month" | "year";
}) {
  const errors: string[] = [];

  if (livemode !== expectedLivemode) {
    errors.push(`${key} (${id}) livemode does not match the selected mode.`);
  }

  if (!active) {
    errors.push(`${key} (${id}) is not active.`);
  }

  if (interval !== expectedInterval) {
    errors.push(
      `${key} (${id}) must be a ${expectedInterval === "month" ? "monthly" : "yearly"} recurring price (got ${interval ?? "unknown"}).`
    );
  }

  return errors;
}
