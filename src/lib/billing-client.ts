import type { BillingInterval, BillingPlanKey } from "@/lib/billing-plans";

async function postForRedirect(
  url: string,
  body?: Record<string, unknown>
): Promise<void> {
  const res = await fetch(url, {
    method: "POST",
    headers: body ? { "Content-Type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = (await res.json().catch(() => null)) as
    | { url?: string; error?: string }
    | null;

  if (!res.ok || !data?.url) {
    throw new Error(data?.error ?? "Request failed");
  }
  window.location.href = data.url;
}

/** Starts Stripe Checkout for a paid plan and redirects to the hosted page. */
export function startCheckout(
  plan: BillingPlanKey,
  interval: BillingInterval
): Promise<void> {
  return postForRedirect("/api/billing/checkout", { plan, interval });
}

/** Opens the Stripe billing portal for the current customer. */
export function openBillingPortal(): Promise<void> {
  return postForRedirect("/api/billing/portal");
}
