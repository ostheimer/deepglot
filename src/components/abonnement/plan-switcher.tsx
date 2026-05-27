"use client";

import { useState } from "react";
import { toast } from "sonner";

import { useLocale } from "@/components/providers/locale-provider";
import {
  BILLING_PLAN_KEYS,
  BILLING_PLANS,
  computeYearlyTotalCents,
  formatYearlyMonthlyEquivalentCents,
  type BillingPlanKey,
} from "@/lib/billing-plans";
import { openBillingPortal, startCheckout } from "@/lib/billing-client";

const PAID_PLAN_KEYS = BILLING_PLAN_KEYS.filter(
  (key) => key !== "FREE" && key !== "ENTERPRISE"
);

function euros(cents: number | null | undefined): number | null {
  return typeof cents === "number" ? Math.round(cents / 100) : null;
}

interface Props {
  currentPlan: BillingPlanKey;
  /** Whether the org already has a Stripe customer (enables the portal). */
  hasStripeCustomer: boolean;
}

export function PlanSwitcher({ currentPlan, hasStripeCustomer }: Props) {
  const locale = useLocale();
  const [yearly, setYearly] = useState(false);
  const [pending, setPending] = useState<string | null>(null);

  const interval = yearly ? "yearly" : "monthly";
  // Plan changes route through the billing portal when an org already has a
  // live Stripe subscription, so Stripe swaps the existing subscription with
  // proration — starting a fresh Checkout would create a second subscription
  // and double-bill the customer.
  //
  // Branching on the plan key alone is wrong: ENTERPRISE is a paid tier that
  // is hand-managed without a Stripe relationship (no customer id, no
  // subscription). Routing those clicks to the portal returns 400 from
  // /api/billing/portal and surfaces as a misleading "billing portal
  // unavailable" toast. Use `hasStripeCustomer` so ENTERPRISE — and any
  // future hand-managed tier — falls through to Checkout, which creates a
  // real Stripe customer/subscription and lets the user self-service switch
  // off the bespoke plan.
  const hasExistingSubscription = hasStripeCustomer;

  async function handleUpgrade(plan: BillingPlanKey) {
    setPending(plan);
    try {
      await startCheckout(plan, interval);
    } catch (error) {
      const fallback =
        locale === "de"
          ? "Checkout konnte nicht gestartet werden."
          : "Could not start checkout.";
      toast.error(error instanceof Error && error.message ? error.message : fallback);
      setPending(null);
    }
  }

  async function handlePortal() {
    setPending("__portal");
    try {
      await openBillingPortal();
    } catch (error) {
      // Surface the specific server-side reason (e.g. "Stripe customer not
      // found", "Portal not configured") instead of the previous generic
      // "billing portal unavailable" — the route now returns these in the
      // error body so the user/operator knows what to do.
      const fallback =
        locale === "de"
          ? "Abrechnungsportal nicht verfügbar."
          : "Billing portal unavailable.";
      toast.error(error instanceof Error && error.message ? error.message : fallback);
      setPending(null);
    }
  }

  return (
    <div className="bg-white border border-gray-200 rounded-xl p-6">
      <div className="flex items-center justify-between mb-5">
        <h2 className="text-base font-semibold text-gray-900">
          {locale === "de" ? "Plan wechseln" : "Change plan"}
        </h2>
        <div className="inline-flex items-center gap-3">
          <span
            className={`text-xs font-medium ${!yearly ? "text-gray-900" : "text-gray-400"}`}
          >
            {locale === "de" ? "Monatlich" : "Monthly"}
          </span>
          <button
            type="button"
            role="switch"
            aria-checked={yearly}
            aria-label={
              locale === "de"
                ? "Jährliche Abrechnung umschalten"
                : "Toggle yearly billing"
            }
            onClick={() => setYearly((value) => !value)}
            className={`relative inline-flex h-5 w-10 shrink-0 items-center rounded-full transition-colors ${
              yearly ? "bg-indigo-600" : "bg-gray-300"
            }`}
          >
            <span
              aria-hidden="true"
              className={`pointer-events-none inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform ${
                yearly ? "translate-x-5" : "translate-x-0.5"
              }`}
            />
          </button>
          <span
            className={`text-xs font-medium ${yearly ? "text-gray-900" : "text-gray-400"}`}
          >
            {locale === "de" ? "Jährlich" : "Yearly"}
          </span>
        </div>
      </div>

      <ul className="divide-y divide-gray-100">
        {PAID_PLAN_KEYS.map((key) => {
          const plan = BILLING_PLANS[key];
          const isCurrent = key === currentPlan;
          const monthly = euros(plan.monthlyPriceCents);
          const yearlyMonthly = euros(formatYearlyMonthlyEquivalentCents(key));
          const yearlyTotal = euros(computeYearlyTotalCents(key));
          const price = yearly ? yearlyMonthly : monthly;

          return (
            <li
              key={key}
              className="flex items-center justify-between gap-4 py-3.5"
            >
              <div className="min-w-0">
                <p className="text-sm font-semibold text-gray-900">
                  {plan.name}
                </p>
                <p className="text-xs text-gray-500 mt-0.5">
                  {price === null ? null : <>€{price}</>}
                  {yearly && yearlyTotal !== null ? (
                    <span className="text-gray-400">
                      {" "}
                      ·{" "}
                      {locale === "de"
                        ? `€${yearlyTotal}/Jahr`
                        : `€${yearlyTotal}/year`}
                    </span>
                  ) : (
                    <span className="text-gray-400">
                      {locale === "de" ? "/Mo." : "/mo."}
                    </span>
                  )}
                </p>
              </div>

              {isCurrent ? (
                <span className="shrink-0 rounded-lg border border-gray-200 bg-gray-50 px-4 py-2 text-sm font-medium text-gray-500">
                  {locale === "de" ? "Aktueller Plan" : "Current plan"}
                </span>
              ) : (
                <button
                  type="button"
                  onClick={() =>
                    hasExistingSubscription ? handlePortal() : handleUpgrade(key)
                  }
                  disabled={pending !== null}
                  className="shrink-0 rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-indigo-700 disabled:opacity-50"
                >
                  {(hasExistingSubscription && pending === "__portal") ||
                  pending === key
                    ? locale === "de"
                      ? "Weiterleiten…"
                      : "Redirecting..."
                    : hasExistingSubscription
                      ? locale === "de"
                        ? "Im Portal ändern"
                        : "Change in portal"
                      : locale === "de"
                        ? "Auswählen"
                        : "Select"}
                </button>
              )}
            </li>
          );
        })}
      </ul>

      {hasStripeCustomer && (
        <div className="mt-5 border-t border-gray-100 pt-4">
          <button
            type="button"
            onClick={handlePortal}
            disabled={pending !== null}
            className="text-sm font-medium text-indigo-600 hover:underline disabled:opacity-50"
          >
            {pending === "__portal"
              ? locale === "de"
                ? "Weiterleiten…"
                : "Redirecting..."
              : locale === "de"
                ? "Zahlungsdaten & Rechnungen verwalten"
                : "Manage billing & invoices"}
          </button>
        </div>
      )}
    </div>
  );
}
