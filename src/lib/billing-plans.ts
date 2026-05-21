import type { SubscriptionStatus } from "@prisma/client";

/**
 * Single source of truth for Deepglot billing plans.
 *
 * Both the marketing pricing grid and the Stripe webhook plan mapping read
 * from this file so the customer-facing tiers, the backend usage limits and
 * the configured Stripe price IDs can never drift apart.
 *
 * Pricing strategy: target ~13–14% below Weglot for every paid tier so the
 * value comparison is obvious without race-to-the-bottom positioning. Yearly
 * billing follows Weglot's "2 months free" model — yearly_total = monthly * 10.
 *
 * No tier advertises any limit as "unlimited"; every tier has finite caps.
 * Customers that need more than the Enterprise caps negotiate a custom
 * contract with usage-based pricing on top.
 */

export const BILLING_PLAN_KEYS = [
  "FREE",
  "STARTER",
  "BUSINESS",
  "PRO",
  "ADVANCED",
  "EXTENDED",
  "ENTERPRISE",
] as const;

export type BillingPlanKey = (typeof BILLING_PLAN_KEYS)[number];

export type BillingInterval = "monthly" | "yearly";

export type BillingPlan = {
  key: BillingPlanKey;
  /** Public marketing name. */
  name: string;
  /** Monthly subscription price in cents (€). null = custom / contact sales. */
  monthlyPriceCents: number | null;
  /**
   * Total annual price in cents when paying yearly. Follows Weglot's
   * `monthlyPriceCents * 10` convention so the marketing claim "2 months
   * free" is mathematically true. null = custom / contact sales.
   */
  yearlyPriceCents: number | null;
  /** Hard ceiling on translated words per billing month. */
  wordsLimit: number;
  /** Hard ceiling on configured target languages. */
  languagesLimit: number;
  /** Hard ceiling on configured projects (websites). */
  projectsLimit: number;
  /** Marks the plan that should receive visual emphasis on the pricing grid. */
  highlight: boolean;
  /** Stripe price-id environment key for the monthly price, or null. */
  stripePriceIdEnvKeys: {
    monthly: string | null;
    yearly: string | null;
  };
};

export const BILLING_PLANS: Record<BillingPlanKey, BillingPlan> = {
  FREE: {
    key: "FREE",
    name: "Free",
    monthlyPriceCents: 0,
    yearlyPriceCents: 0,
    wordsLimit: 10_000,
    languagesLimit: 1,
    projectsLimit: 1,
    highlight: false,
    stripePriceIdEnvKeys: { monthly: null, yearly: null },
  },
  STARTER: {
    key: "STARTER",
    name: "Starter",
    monthlyPriceCents: 1300,
    yearlyPriceCents: 13_000,
    wordsLimit: 25_000,
    languagesLimit: 2,
    projectsLimit: 2,
    highlight: false,
    stripePriceIdEnvKeys: {
      monthly: "STRIPE_PRICE_STARTER_MONTHLY",
      yearly: "STRIPE_PRICE_STARTER_YEARLY",
    },
  },
  BUSINESS: {
    key: "BUSINESS",
    name: "Business",
    monthlyPriceCents: 2500,
    yearlyPriceCents: 25_000,
    wordsLimit: 50_000,
    languagesLimit: 3,
    projectsLimit: 3,
    highlight: false,
    stripePriceIdEnvKeys: {
      monthly: "STRIPE_PRICE_BUSINESS_MONTHLY",
      yearly: "STRIPE_PRICE_BUSINESS_YEARLY",
    },
  },
  PRO: {
    key: "PRO",
    name: "Pro",
    monthlyPriceCents: 6900,
    yearlyPriceCents: 69_000,
    wordsLimit: 200_000,
    languagesLimit: 5,
    projectsLimit: 5,
    highlight: true,
    stripePriceIdEnvKeys: {
      monthly: "STRIPE_PRICE_PRO_MONTHLY",
      yearly: "STRIPE_PRICE_PRO_YEARLY",
    },
  },
  ADVANCED: {
    key: "ADVANCED",
    name: "Advanced",
    monthlyPriceCents: 25_900,
    yearlyPriceCents: 259_000,
    wordsLimit: 1_000_000,
    languagesLimit: 10,
    projectsLimit: 10,
    highlight: false,
    stripePriceIdEnvKeys: {
      monthly: "STRIPE_PRICE_ADVANCED_MONTHLY",
      yearly: "STRIPE_PRICE_ADVANCED_YEARLY",
    },
  },
  EXTENDED: {
    key: "EXTENDED",
    name: "Extended",
    monthlyPriceCents: 59_900,
    yearlyPriceCents: 599_000,
    wordsLimit: 5_000_000,
    languagesLimit: 20,
    projectsLimit: 25,
    highlight: false,
    stripePriceIdEnvKeys: {
      monthly: "STRIPE_PRICE_EXTENDED_MONTHLY",
      yearly: "STRIPE_PRICE_EXTENDED_YEARLY",
    },
  },
  ENTERPRISE: {
    key: "ENTERPRISE",
    name: "Enterprise",
    monthlyPriceCents: null,
    yearlyPriceCents: null,
    wordsLimit: 20_000_000,
    languagesLimit: 50,
    projectsLimit: 100,
    highlight: false,
    stripePriceIdEnvKeys: { monthly: null, yearly: null },
  },
};

/**
 * Total annual cost when paying yearly, in cents.
 *
 * Follows Weglot's convention `monthlyPriceCents * 10` so the marketing claim
 * "2 months free" is literally true: customers pay for ten months and receive
 * twelve months of access.
 */
export function computeYearlyTotalCents(key: BillingPlanKey): number | null {
  const plan = BILLING_PLANS[key];
  if (plan.monthlyPriceCents === null) return null;
  if (plan.yearlyPriceCents !== null) return plan.yearlyPriceCents;
  return plan.monthlyPriceCents * 10;
}

/**
 * Effective monthly price displayed when the yearly toggle is active.
 *
 * Equals `yearly_total / 12` rounded to the nearest cent. The marketing UI
 * may further round to whole euros for display.
 */
export function formatYearlyMonthlyEquivalentCents(
  key: BillingPlanKey
): number | null {
  const yearly = computeYearlyTotalCents(key);
  if (yearly === null) return null;
  if (yearly === 0) return 0;
  return Math.round(yearly / 12);
}

export type StripeDescriptionLocale = "de" | "en";

/**
 * Per-tier marketing tagline appended to the Stripe Product description.
 * Lives next to BILLING_PLANS so adding a new plan forces an editor to
 * supply both locales — Stripe Checkout renders the description verbatim,
 * so silently falling back to one locale would regress the customer-facing
 * copy on the other.
 */
const STRIPE_PRODUCT_TAGLINES: Record<
  StripeDescriptionLocale,
  Record<BillingPlanKey, string>
> = {
  de: {
    FREE: "kostenlos zum Ausprobieren.",
    STARTER: "KI-Übersetzung für kleine Websites.",
    BUSINESS: "für wachsende Online-Shops und Blogs.",
    PRO: "für Marken mit professionellem Auftritt.",
    ADVANCED: "für skalierende E-Commerce-Plattformen.",
    EXTENDED: "Enterprise-Volumen für Marken-Konglomerate.",
    ENTERPRISE: "Volumen nach Vereinbarung.",
  },
  en: {
    FREE: "free tier to try Deepglot.",
    STARTER: "AI translation for small websites.",
    BUSINESS: "for growing online shops and blogs.",
    PRO: "for brands with a professional presence.",
    ADVANCED: "for scaling e-commerce platforms.",
    EXTENDED: "enterprise-scale volume for brand conglomerates.",
    ENTERPRISE: "custom volume on contract.",
  },
};

/**
 * Customer-facing one-line description for a billing plan's Stripe Product.
 * Shown on the hosted Stripe Checkout page, so it must stay in sync with the
 * limits the app actually enforces — derive everything from BILLING_PLANS
 * rather than hardcoding numbers in the setup script.
 *
 * Default locale is `"de"` because Deepglot is German-first; passing nothing
 * matches the hand-curated descriptions on the existing live products, so
 * re-running `scripts/stripe-setup.ts --mode live` never silently swaps the
 * customer-facing copy from German to English.
 */
export function formatStripeProductDescription(
  key: BillingPlanKey,
  locale: StripeDescriptionLocale = "de"
): string {
  const plan = BILLING_PLANS[key];
  const tagline = STRIPE_PRODUCT_TAGLINES[locale][key];

  if (locale === "de") {
    const words = plan.wordsLimit.toLocaleString("de-DE");
    const languages = `${plan.languagesLimit} ${plan.languagesLimit === 1 ? "Sprache" : "Sprachen"}`;
    const projects = `${plan.projectsLimit} ${plan.projectsLimit === 1 ? "Projekt" : "Projekte"}`;
    return `${words} Wörter / Monat, ${languages}, ${projects} — ${tagline}`;
  }

  const words = plan.wordsLimit.toLocaleString("en-US");
  const languages = `${plan.languagesLimit} ${plan.languagesLimit === 1 ? "language" : "languages"}`;
  const projects = `${plan.projectsLimit} ${plan.projectsLimit === 1 ? "project" : "projects"}`;
  return `${words} words/month · ${languages} · ${projects} · ${tagline}`;
}

export function getStripePriceIdFromEnv(
  key: BillingPlanKey,
  interval: BillingInterval,
  env: Record<string, string | undefined> = process.env
): string | null {
  const plan = BILLING_PLANS[key];
  const envKey = plan.stripePriceIdEnvKeys[interval];
  if (!envKey) return null;
  const value = env[envKey];
  return value && value.trim() !== "" ? value : null;
}

/**
 * Resolves the per-billing-month word ceiling that should be enforced for a
 * subscription right now. ACTIVE and TRIALING subscriptions get their full
 * paid quota; every other status (PAST_DUE, INACTIVE, CANCELED) is soft-capped
 * at the FREE-tier ceiling so the customer's site keeps serving cached and
 * already-translated content but cannot consume large new quotas while the
 * billing relationship is broken. Missing subscription rows are treated as
 * FREE so callers do not need separate null-handling.
 */
export function getEffectiveWordsLimit(
  subscription:
    | { status: SubscriptionStatus; wordsLimit: number }
    | null
    | undefined
): number {
  const freeLimit = BILLING_PLANS.FREE.wordsLimit;
  if (!subscription) return freeLimit;

  if (subscription.status === "ACTIVE" || subscription.status === "TRIALING") {
    return subscription.wordsLimit;
  }

  return Math.min(subscription.wordsLimit, freeLimit);
}

/**
 * Lookup helper used by the Stripe webhook route to resolve a configured
 * Stripe price id back to its plan key. Falls back to FREE so unknown price
 * ids never crash the webhook handler — they should never occur in practice
 * because Checkout is restricted to the configured plans.
 */
export function findPlanKeyByStripePriceId(
  priceId: string,
  env: Record<string, string | undefined> = process.env
): BillingPlanKey {
  for (const key of BILLING_PLAN_KEYS) {
    const plan = BILLING_PLANS[key];
    for (const interval of ["monthly", "yearly"] as const) {
      const envKey = plan.stripePriceIdEnvKeys[interval];
      if (envKey && env[envKey] === priceId) {
        return key;
      }
    }
  }
  return "FREE";
}
