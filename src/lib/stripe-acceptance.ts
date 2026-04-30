export type StripeAcceptanceMode = "test" | "live";

export type StripeAcceptanceEnv = {
  STRIPE_SECRET_KEY?: string;
  NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY?: string;
  STRIPE_WEBHOOK_SECRET?: string;
  STRIPE_PRICE_STARTER_MONTHLY?: string;
  STRIPE_PRICE_PROFESSIONAL_MONTHLY?: string;
  STRIPE_PRICE_ENTERPRISE_MONTHLY?: string;
};

export type StripeAcceptanceValidationInput = {
  mode: StripeAcceptanceMode;
  env: StripeAcceptanceEnv;
};

const PRICE_KEYS = [
  "STRIPE_PRICE_STARTER_MONTHLY",
  "STRIPE_PRICE_PROFESSIONAL_MONTHLY",
  "STRIPE_PRICE_ENTERPRISE_MONTHLY",
] as const;

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
  const secretPrefix = expectedLivemode ? "sk_live_" : "sk_test_";
  const publishablePrefix = expectedLivemode ? "pk_live_" : "pk_test_";

  if (!env.STRIPE_SECRET_KEY) {
    errors.push("STRIPE_SECRET_KEY is required.");
  } else if (!env.STRIPE_SECRET_KEY.startsWith(secretPrefix)) {
    errors.push(
      `STRIPE_SECRET_KEY must start with ${secretPrefix} for ${mode} acceptance.`
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
}: {
  key: string;
  id: string;
  livemode: boolean;
  active: boolean;
  interval?: string | null;
  expectedLivemode: boolean;
}) {
  const errors: string[] = [];

  if (livemode !== expectedLivemode) {
    errors.push(`${key} (${id}) livemode does not match the selected mode.`);
  }

  if (!active) {
    errors.push(`${key} (${id}) is not active.`);
  }

  if (interval !== "month") {
    errors.push(`${key} (${id}) must be a monthly recurring price.`);
  }

  return errors;
}
