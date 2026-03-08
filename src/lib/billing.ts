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

export function getBillingPortalReturnUrl(): string {
  const baseUrl =
    process.env.AUTH_URL ??
    process.env.NEXT_PUBLIC_APP_URL ??
    getVercelDeploymentBaseUrl();

  if (!baseUrl) {
    throw new Error(
      "Missing AUTH_URL, NEXT_PUBLIC_APP_URL, or Vercel system URL for the billing portal return URL."
    );
  }

  return new URL(BILLING_PORTAL_RETURN_PATH, baseUrl).toString();
}
