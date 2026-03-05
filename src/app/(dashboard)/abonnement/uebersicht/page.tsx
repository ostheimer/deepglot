import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { redirect } from "next/navigation";
import Link from "next/link";
import { stripe } from "@/lib/stripe";
import { CancelSubscriptionButton } from "@/components/abonnement/cancel-subscription-button";
import { AutoUpgradeToggle } from "@/components/abonnement/auto-upgrade-toggle";

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

export default async function PlanUebersichtPage() {
  const session = await auth();
  if (!session?.user?.id) redirect("/anmelden");

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
        nextInvoiceDate = new Date(periodEnd * 1000).toLocaleDateString("de-AT", {
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
      <h1 className="text-2xl font-bold text-gray-900 mb-6">Plan-Übersicht</h1>

      <div className="bg-white border border-gray-200 rounded-xl p-8">
        <p className="text-sm text-gray-600 mb-3">Dein aktueller Plan ist:</p>

        <h2 className="text-lg font-bold text-indigo-600 mb-2">
          {PLAN_LABELS[plan]} {plan !== "FREE" ? "(Monatlich)" : ""}
        </h2>

        {nextInvoiceDate && nextInvoiceAmount !== null && (
          <p className="text-sm text-gray-600 mb-4">
            Deine nächste Rechnung beträgt €{nextInvoiceAmount.toFixed(2)} am {nextInvoiceDate}
          </p>
        )}

        {/* Features list */}
        <ul className="space-y-1.5 mb-5">
          <li className="text-sm text-gray-700">{features.languages} übersetzte Sprachen</li>
          <li className="text-sm text-gray-700">{features.projects} Projekte</li>
          <li className="text-sm text-gray-700">{features.words.toLocaleString("de-AT")} übersetzte Wörter</li>
          <li className="text-sm text-gray-700">{features.requests.toLocaleString("de-AT")} Übersetzungs-Anfragen/Monat</li>
        </ul>

        <p className="text-sm text-gray-600 mb-6">
          Überprüfe deine{" "}
          <Link href="/abonnement/nutzung" className="text-indigo-600 hover:underline">
            Plan-Nutzung für alle Projekte.
          </Link>
        </p>

        {/* Auto-upgrade */}
        <div className="flex items-start gap-3 py-5 border-t border-gray-100">
          <AutoUpgradeToggle defaultChecked={false} />
          <div>
            <p className="text-sm font-medium text-gray-900">Auto-Upgrade</p>
            <p className="text-sm text-gray-500 mt-0.5">
              Vermeide Unterbrechungen des Übersetzungsdienstes – dein Plan wird automatisch
              upgradet, wenn dein Wort-Limit erreicht wird.
            </p>
          </div>
        </div>

        {/* Actions */}
        <div className="flex items-center justify-between pt-5 border-t border-gray-100">
          <CancelSubscriptionButton
            subscriptionId={sub?.stripeSubscriptionId ?? null}
            plan={plan}
          />
          <Link href="/abonnement/plan-wechseln">
            <button className="bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-medium px-5 py-2 rounded-lg transition-colors">
              Plan wechseln
            </button>
          </Link>
        </div>
      </div>
    </div>
  );
}
