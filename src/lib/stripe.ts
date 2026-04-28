import Stripe from "stripe";

export const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, {
  apiVersion: "2026-02-25.clover",
  typescript: true,
});

// Plan definitions with limits and Stripe price IDs
export const PLANS = {
  FREE: {
    name: "Free",
    wordsLimit: 10_000,
    priceMonthly: 0,
    stripePriceId: null,
    features: [
      "10.000 Wörter/Monat",
      "1 Projekt",
      "2 Sprachen",
      "Community Support",
    ],
  },
  STARTER: {
    name: "Starter",
    wordsLimit: 200_000,
    priceMonthly: 1499, // in cents
    stripePriceId: process.env.STRIPE_PRICE_STARTER_MONTHLY,
    features: [
      "200.000 Wörter/Monat",
      "5 Projekte",
      "10 Sprachen",
      "E-Mail Support",
      "Moderne KI-Übersetzung",
    ],
  },
  PROFESSIONAL: {
    name: "Professional",
    wordsLimit: 1_000_000,
    priceMonthly: 4999, // in cents
    stripePriceId: process.env.STRIPE_PRICE_PROFESSIONAL_MONTHLY,
    features: [
      "1.000.000 Wörter/Monat",
      "Unbegrenzte Projekte",
      "Alle Sprachen",
      "Prioritäts-Support",
      "Provider-Auswahl",
      "Visueller Editor",
    ],
  },
  ENTERPRISE: {
    name: "Enterprise",
    wordsLimit: 10_000_000,
    priceMonthly: 19999, // in cents
    stripePriceId: process.env.STRIPE_PRICE_ENTERPRISE_MONTHLY,
    features: [
      "10.000.000 Wörter/Monat",
      "Alles aus Professional",
      "Dedicated Support",
      "SLA",
      "Custom Integrationen",
    ],
  },
} as const;

export type PlanKey = keyof typeof PLANS;
