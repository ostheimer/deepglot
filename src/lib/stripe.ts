import Stripe from "stripe";

import {
  BILLING_PLANS,
  BILLING_PLAN_KEYS,
  type BillingPlan,
  type BillingPlanKey,
} from "@/lib/billing-plans";

export const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, {
  apiVersion: "2026-02-25.clover",
  typescript: true,
});

/**
 * Backwards-compatible plan map. New code should import BILLING_PLANS from
 * `@/lib/billing-plans` directly; this object is kept so existing imports
 * (`PLANS.FREE.wordsLimit` etc.) keep compiling without churn.
 *
 * The shape mirrors the legacy export:
 *   - name        : public marketing name
 *   - wordsLimit  : monthly word ceiling
 *   - priceMonthly: monthly price in cents (0 for FREE, null for ENTERPRISE)
 *   - stripePriceId: configured Stripe monthly price id (or null)
 */
type LegacyPlanShape = {
  name: string;
  wordsLimit: number;
  priceMonthly: number | null;
  stripePriceId: string | null;
};

function readEnvPriceId(plan: BillingPlan): string | null {
  const envKey = plan.stripePriceIdEnvKeys.monthly;
  if (!envKey) return null;
  const value = process.env[envKey];
  return value && value.trim() !== "" ? value : null;
}

export const PLANS = BILLING_PLAN_KEYS.reduce(
  (accumulator, key) => {
    const plan = BILLING_PLANS[key];
    accumulator[key] = {
      name: plan.name,
      wordsLimit: plan.wordsLimit,
      priceMonthly: plan.monthlyPriceCents,
      stripePriceId: readEnvPriceId(plan),
    };
    return accumulator;
  },
  {} as Record<BillingPlanKey, LegacyPlanShape>
);

export type PlanKey = BillingPlanKey;
