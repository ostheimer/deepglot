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
