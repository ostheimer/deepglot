const BILLING_PORTAL_RETURN_PATH = "/subscription/billing";

function normalizeBaseUrl(value: string | undefined): string | null {
  if (!value) {
    return null;
  }

  if (value.startsWith("http://") || value.startsWith("https://")) {
    return value;
  }

  return `https://${value}`;
}

function getVercelDeploymentBaseUrl(): string | null {
  if (!process.env.VERCEL) {
    return null;
  }

  const deploymentHost =
    process.env.VERCEL_ENV === "production"
      ? process.env.VERCEL_PROJECT_PRODUCTION_URL ??
        process.env.VERCEL_BRANCH_URL ??
        process.env.VERCEL_URL
      : process.env.VERCEL_BRANCH_URL ??
        process.env.VERCEL_URL ??
        process.env.VERCEL_PROJECT_PRODUCTION_URL;

  return normalizeBaseUrl(deploymentHost);
}

/**
 * Recognise whether a `subscription.stripeCustomerId` value points at a real
 * Stripe customer (something the Stripe API will accept) or at one of the
 * internal placeholder conventions used when the org has no Stripe
 * relationship yet:
 *
 *   - `free_<userId|orgId>`   — written at registration (Free tier) and by
 *                                the seeded test login.
 *   - `manual_<orgId>`        — written by hand (or by ad-hoc admin scripts)
 *                                when an org is flagged onto a non-Stripe
 *                                tier such as ENTERPRISE.
 *
 * Real Stripe customer ids always start with `cus_`. We allowlist that prefix
 * instead of blacklisting individual placeholder schemes so any future
 * placeholder (e.g. `comp_`, `trial_`) is treated as non-Stripe by default
 * and cannot regress into "billing portal unavailable" toasts.
 *
 * Returning `false` means: do not call Stripe APIs (portal, subscriptions,
 * invoices) with this id; route plan changes through Checkout to create a
 * real customer instead.
 */
export function isRealStripeCustomerId(
  customerId: string | null | undefined
): customerId is string {
  return typeof customerId === "string" && customerId.startsWith("cus_");
}

export function getAppBaseUrl(): string {
  const baseUrl =
    process.env.AUTH_URL ??
    process.env.NEXT_PUBLIC_APP_URL ??
    getVercelDeploymentBaseUrl();

  if (!baseUrl) {
    throw new Error(
      "Missing AUTH_URL, NEXT_PUBLIC_APP_URL, or Vercel system URL for billing redirect URLs."
    );
  }

  return baseUrl;
}

export function getBillingPortalReturnUrl(): string {
  return new URL(BILLING_PORTAL_RETURN_PATH, getAppBaseUrl()).toString();
}

/**
 * Where Stripe sends the customer after a Checkout session. Success lands on
 * the subscription overview so the freshly-applied plan (written by the
 * `checkout.session.completed` webhook) is visible immediately; cancel returns
 * to the public pricing grid so the customer can pick a different tier.
 */
export function getCheckoutSuccessUrl(): string {
  return new URL(
    "/subscription/overview?checkout=success",
    getAppBaseUrl()
  ).toString();
}

export function getCheckoutCancelUrl(): string {
  return new URL("/pricing?checkout=cancelled", getAppBaseUrl()).toString();
}

/** Minimal subscription shape for checkout duplicate guards. */
export type ExistingSubscriptionForCheckout = {
  stripeSubscriptionId: string | null | undefined;
  status: string | null | undefined;
};

/**
 * Whether `POST /api/billing/checkout` must refuse to start a new Stripe
 * Checkout session. Orgs with an existing Stripe subscription id in a
 * non-terminal state must change plans via the billing portal (proration) —
 * a fresh Checkout would create a second paid subscription.
 *
 * PAST_DUE and INACTIVE are included: any non-null `stripeSubscriptionId`
 * means Stripe still has (or is retrying) a subscription — a fresh Checkout
 * would create a second paid subscription. Only `CANCELED` (written after
 * `customer.subscription.deleted`) may start Checkout again.
 */
export function blocksNewCheckoutForExistingSubscription(
  subscription: ExistingSubscriptionForCheckout | null | undefined
): boolean {
  if (!subscription?.stripeSubscriptionId) {
    return false;
  }
  return subscription.status !== "CANCELED";
}

/** Stripe statuses where a second Checkout would create duplicate billing. */
const BLOCKING_STRIPE_SUBSCRIPTION_STATUSES = new Set([
  "active",
  "trialing",
  "past_due",
  "unpaid",
  "paused",
  "incomplete",
]);

/**
 * True when Stripe still has a non-terminal subscription for this customer.
 * Closes the TOCTOU gap where `stripeSubscriptionId` is not in the DB until the
 * webhook runs but Stripe already has a live (or retrying) subscription.
 */
export function stripeSubscriptionStatusBlocksCheckout(
  status: string
): boolean {
  return BLOCKING_STRIPE_SUBSCRIPTION_STATUSES.has(status);
}

export type StripeSubscriptionListClient = {
  subscriptions: {
    list: (params: {
      customer: string;
      limit: number;
      starting_after?: string;
    }) => Promise<{
      data: Array<{ id: string; status: string }>;
      has_more: boolean;
    }>;
  };
};

/**
 * Ask Stripe whether this customer already has a subscription that must not be
 * duplicated via a fresh Checkout session. Pages through every subscription —
 * a blocking one can sit on any page, and a missed page would re-open the
 * duplicate-billing gap this guard exists to close.
 */
export async function customerHasBlockingStripeSubscription(
  customerId: string,
  stripeClient: StripeSubscriptionListClient
): Promise<boolean> {
  let startingAfter: string | undefined;
  for (;;) {
    const page = await stripeClient.subscriptions.list({
      customer: customerId,
      limit: 100,
      ...(startingAfter ? { starting_after: startingAfter } : {}),
    });
    if (
      page.data.some((sub) => stripeSubscriptionStatusBlocksCheckout(sub.status))
    ) {
      return true;
    }
    if (!page.has_more || page.data.length === 0) {
      return false;
    }
    startingAfter = page.data[page.data.length - 1].id;
  }
}
