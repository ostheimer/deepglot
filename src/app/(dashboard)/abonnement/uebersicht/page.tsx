import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { redirect } from "next/navigation";
import Link from "next/link";
import { stripe } from "@/lib/stripe";
import { CancelSubscriptionButton } from "@/components/abonnement/cancel-subscription-button";
import { PlanSwitcher } from "@/components/abonnement/plan-switcher";
import { Badge } from "@/components/ui/badge";
import { formatNumber, getIntlLocale } from "@/lib/locale-formatting";
import { getPageLocale, type LocaleSearchParams } from "@/lib/request-locale";
import { withLocalePrefix } from "@/lib/site-locale";
import {
  BILLING_PLANS,
  BILLING_PLAN_KEYS,
  type BillingPlanKey,
} from "@/lib/billing-plans";

export const metadata = { title: "Plan-Übersicht – Deepglot" };

function normalizePlan(plan: string | null | undefined): BillingPlanKey {
  if (plan === "PROFESSIONAL") return "PRO";
  return (BILLING_PLAN_KEYS as readonly string[]).includes(plan ?? "")
    ? (plan as BillingPlanKey)
    : "FREE";
}

const STATUS_BADGE: Record<
  string,
  { de: string; en: string; variant: "default" | "outline" | "destructive" }
> = {
  ACTIVE: { de: "Aktiv", en: "Active", variant: "default" },
  TRIALING: { de: "Testphase", en: "Trial", variant: "default" },
  PAST_DUE: { de: "Zahlung überfällig", en: "Past due", variant: "destructive" },
  CANCELED: { de: "Gekündigt", en: "Canceled", variant: "outline" },
  INACTIVE: { de: "Inaktiv", en: "Inactive", variant: "outline" },
};

type PlanUebersichtPageProps = {
  searchParams: LocaleSearchParams;
};

export default async function PlanUebersichtPage({
  searchParams,
}: PlanUebersichtPageProps) {
  const locale = await getPageLocale(searchParams);
  const session = await auth();
  if (!session?.user?.id) redirect(withLocalePrefix("/login", locale));

  const membership = await db.organizationMember.findFirst({
    where: { userId: session.user.id },
    include: {
      organization: {
        include: { subscription: true },
      },
    },
  });

  const org = membership?.organization;
  const sub = org?.subscription;
  const planKey = normalizePlan(org?.plan);
  const plan = BILLING_PLANS[planKey];
  const status = sub?.status ?? "INACTIVE";
  const statusBadge = STATUS_BADGE[status] ?? STATUS_BADGE.INACTIVE;

  const hasStripeCustomer =
    !!sub?.stripeCustomerId && !sub.stripeCustomerId.startsWith("free_");

  // Next invoice date from Stripe (best effort — never blocks the page).
  let nextInvoiceDate: string | null = null;
  if (sub?.stripeSubscriptionId) {
    try {
      const stripeSub = await stripe.subscriptions.retrieve(
        sub.stripeSubscriptionId
      );
      const periodEnd = stripeSub.items.data[0]?.current_period_end;
      if (periodEnd) {
        nextInvoiceDate = new Date(periodEnd * 1000).toLocaleDateString(
          getIntlLocale(locale),
          { year: "numeric", month: "2-digit", day: "2-digit" }
        );
      }
    } catch {
      // Stripe not configured or subscription not found.
    }
  }

  return (
    <div className="space-y-5">
      <h1 className="text-2xl font-bold text-gray-900">
        {locale === "de" ? "Plan-Übersicht" : "Plan overview"}
      </h1>

      <div className="bg-white border border-gray-200 rounded-xl p-8">
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="text-sm text-gray-600 mb-1">
              {locale === "de"
                ? "Dein aktueller Plan ist:"
                : "Your current plan is:"}
            </p>
            <h2 className="text-lg font-bold text-indigo-600">{plan.name}</h2>
          </div>
          <Badge variant={statusBadge.variant} className="shrink-0">
            {locale === "de" ? statusBadge.de : statusBadge.en}
          </Badge>
        </div>

        {nextInvoiceDate && (
          <p className="text-sm text-gray-600 mt-3">
            {locale === "de"
              ? `Deine nächste Rechnung ist am ${nextInvoiceDate}`
              : `Your next invoice is on ${nextInvoiceDate}`}
          </p>
        )}

        <ul className="space-y-1.5 mt-5">
          <li className="text-sm text-gray-700">
            {plan.languagesLimit}{" "}
            {locale === "de" ? "übersetzte Sprachen" : "translated languages"}
          </li>
          <li className="text-sm text-gray-700">
            {plan.projectsLimit} {locale === "de" ? "Projekte" : "projects"}
          </li>
          <li className="text-sm text-gray-700">
            {formatNumber(plan.wordsLimit, locale)}{" "}
            {locale === "de" ? "übersetzte Wörter / Monat" : "translated words / month"}
          </li>
        </ul>

        <p className="text-sm text-gray-600 mt-5">
          {locale === "de" ? "Überprüfe deine" : "Review your"}{" "}
          <Link
            href={withLocalePrefix("/subscription/usage", locale)}
            className="text-indigo-600 hover:underline"
          >
            {locale === "de"
              ? "Plan-Nutzung für alle Projekte."
              : "plan usage across all projects."}
          </Link>
        </p>

        <div className="flex items-center justify-between pt-5 mt-5 border-t border-gray-100">
          <CancelSubscriptionButton
            subscriptionId={sub?.stripeSubscriptionId ?? null}
            plan={planKey}
          />
        </div>
      </div>

      <PlanSwitcher currentPlan={planKey} hasStripeCustomer={hasStripeCustomer} />
    </div>
  );
}
