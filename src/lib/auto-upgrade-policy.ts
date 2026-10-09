import { BILLING_PLAN_KEYS, BILLING_PLANS, type BillingInterval, type BillingPlanKey } from "./billing-plans";
import { isRealStripeCustomerId } from "./billing";

export const AUTO_UPGRADE_THRESHOLD = 0.9;
export const AUTO_UPGRADE_ELIGIBLE_PLANS = ["STARTER", "BUSINESS", "PRO", "ADVANCED", "EXTENDED"] as const;

export type AutoUpgradeDecision = { from: BillingPlanKey; to: BillingPlanKey; interval: BillingInterval; priceCents: number };

/** A conservative single paid tier. Both the owner's ceiling and a fresh Stripe price must be checked again before the write. */
export function chooseAutoUpgrade(input: {
  enabled: boolean;
  plan: string;
  maxPlan: string;
  interval: BillingInterval;
  maxPriceCents: number;
  usedWords: number;
  status: string;
  customerId: string | null;
  subscriptionId: string | null;
  cancelAtPeriodEnd: boolean;
  hasPendingUpdate: boolean;
}): AutoUpgradeDecision | null {
  if (!input.enabled || input.status !== "ACTIVE" || !isRealStripeCustomerId(input.customerId) ||
      !input.subscriptionId?.startsWith("sub_") || input.cancelAtPeriodEnd || input.hasPendingUpdate) return null;
  const from = input.plan === "PROFESSIONAL" ? "PRO" : input.plan;
  const fromIndex = BILLING_PLAN_KEYS.indexOf(from as BillingPlanKey);
  const ceilingIndex = BILLING_PLAN_KEYS.indexOf(input.maxPlan as BillingPlanKey);
  if (fromIndex < 1 || fromIndex >= BILLING_PLAN_KEYS.length - 2 || ceilingIndex <= fromIndex) return null;
  const current = BILLING_PLANS[from as BillingPlanKey];
  if (input.usedWords < Math.ceil(current.wordsLimit * AUTO_UPGRADE_THRESHOLD)) return null;
  const to = BILLING_PLAN_KEYS[fromIndex + 1];
  const priceCents = input.interval === "monthly" ? BILLING_PLANS[to].monthlyPriceCents : BILLING_PLANS[to].yearlyPriceCents;
  if (priceCents === null || priceCents > input.maxPriceCents) return null;
  return { from: from as BillingPlanKey, to, interval: input.interval, priceCents };
}
