import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { redirect } from "next/navigation";
import Link from "next/link";
import { stripe } from "@/lib/stripe";
import { CancelSubscriptionButton } from "@/components/abonnement/cancel-subscription-button";
import { AutoUpgradeToggle } from "@/components/abonnement/auto-upgrade-toggle";
import { formatNumber, getIntlLocale } from "@/lib/locale-formatting";
import { getPageLocale, type LocaleSearchParams } from "@/lib/request-locale";
import { withLocalePrefix } from "@/lib/site-locale";

export const metadata = { title: "Plan-Übersicht – Deepglot" };

const PLAN_FEATURES: Record<string, { languages: number; projects: number; words: number; requests: number; price: number }> = {
  FREE:         { languages: 1,  projects: 1,  words: 10_000,      requests: 1_000,       price: 0 },
  STARTER:      { languages: 3,  projects: 3,  words: 100_000,     requests: 50_000,      price: 19 },
  PROFESSIONAL: { languages: 10, projects: 10, words: 1_000_000,   requests: 1_000_000,   price: 99 },
  ENTERPRISE:   { languages: 50, projects: 50, words: 10_000_000,  requests: 10_000_000,  price: 289 },
};

const PLAN_LABELS: Record<string, string> = {
  FREE: "Free",
  STARTER: "Starter",
  PROFESSIONAL: "Advanced",
  ENTERPRISE: "Enterprise",
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
  const plan = org?.plan ?? "FREE";
  const features = PLAN_FEATURES[plan] ?? PLAN_FEATURES.FREE;

  // Next invoice date from Stripe
  let nextInvoiceDate: string | null = null;
  let nextInvoiceAmount: number | null = null;

  if (sub?.stripeSubscriptionId) {
    try {
      const stripeSub = await stripe.subscriptions.retrieve(sub.stripeSubscriptionId);
      const items = stripeSub.items.data;
      const periodEnd = items[0]?.current_period_end;
      if (periodEnd) {
        nextInvoiceDate = new Date(periodEnd * 1000).toLocaleDateString(getIntlLocale(locale), {
          year: "numeric", month: "2-digit", day: "2-digit",
        });
      }
      nextInvoiceAmount = features.price;
    } catch {
      // Stripe not configured or subscription not found
    }
  }

  return (
    <div>
      <h1 className="text-2xl font-bold text-gray-900 mb-6">
        {locale === "de" ? "Plan-Übersicht" : "Plan overview"}
      </h1>

      <div className="bg-white border border-gray-200 rounded-xl p-8">
        <p className="text-sm text-gray-600 mb-3">
          {locale === "de" ? "Dein aktueller Plan ist:" : "Your current plan is:"}
        </p>

        <h2 className="text-lg font-bold text-indigo-600 mb-2">
          {PLAN_LABELS[plan]} {plan !== "FREE" ? locale === "de" ? "(Monatlich)" : "(Monthly)" : ""}
        </h2>

        {nextInvoiceDate && nextInvoiceAmount !== null && (
          <p className="text-sm text-gray-600 mb-4">
            {locale === "de"
              ? `Deine nächste Rechnung beträgt €${nextInvoiceAmount.toFixed(2)} am ${nextInvoiceDate}`
              : `Your next invoice is €${nextInvoiceAmount.toFixed(2)} on ${nextInvoiceDate}`}
          </p>
        )}

        {/* Features list */}
        <ul className="space-y-1.5 mb-5">
          <li className="text-sm text-gray-700">
            {features.languages} {locale === "de" ? "übersetzte Sprachen" : "translated languages"}
          </li>
          <li className="text-sm text-gray-700">
            {features.projects} {locale === "de" ? "Projekte" : "projects"}
          </li>
          <li className="text-sm text-gray-700">
            {formatNumber(features.words, locale)} {locale === "de" ? "übersetzte Wörter" : "translated words"}
          </li>
          <li className="text-sm text-gray-700">
            {formatNumber(features.requests, locale)} {locale === "de" ? "Übersetzungs-Anfragen/Monat" : "translation requests/month"}
          </li>
        </ul>

        <p className="text-sm text-gray-600 mb-6">
          {locale === "de" ? "Überprüfe deine" : "Review your"}{" "}
          <Link href={withLocalePrefix("/subscription/usage", locale)} className="text-indigo-600 hover:underline">
            {locale === "de" ? "Plan-Nutzung für alle Projekte." : "plan usage across all projects."}
          </Link>
        </p>

        {/* Auto-upgrade */}
        <div className="flex items-start gap-3 py-5 border-t border-gray-100">
          <AutoUpgradeToggle defaultChecked={false} />
          <div>
            <p className="text-sm font-medium text-gray-900">Auto-Upgrade</p>
            <p className="text-sm text-gray-500 mt-0.5">
              {locale === "de"
                ? "Vermeide Unterbrechungen des Übersetzungsdienstes – dein Plan wird automatisch upgradet, wenn dein Wort-Limit erreicht wird."
                : "Avoid translation interruptions. Your plan upgrades automatically once you reach your word limit."}
            </p>
          </div>
        </div>

        {/* Actions */}
        <div className="flex items-center justify-between pt-5 border-t border-gray-100">
          <CancelSubscriptionButton
            subscriptionId={sub?.stripeSubscriptionId ?? null}
            plan={plan}
          />
          <Link href={withLocalePrefix("/subscription", locale)}>
            <button className="bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-medium px-5 py-2 rounded-lg transition-colors">
              {locale === "de" ? "Plan wechseln" : "Change plan"}
            </button>
          </Link>
        </div>
      </div>
    </div>
  );
}
