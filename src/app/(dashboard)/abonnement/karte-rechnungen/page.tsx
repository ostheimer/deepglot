import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { redirect } from "next/navigation";
import { stripe } from "@/lib/stripe";
import { CreditCard } from "lucide-react";
import { PortalButton } from "@/components/abonnement/portal-button";
import { BillingAddressForm } from "@/components/abonnement/billing-address-form";

export const metadata = { title: "Karte & Rechnungen – Deepglot" };

export default async function KarteRechnungenPage() {
  const session = await auth();
  if (!session?.user?.id) redirect("/anmelden");

  const membership = await db.organizationMember.findFirst({
    where: { userId: session.user.id },
    include: {
      organization: { include: { subscription: true } },
    },
  });

  const sub = membership?.organization?.subscription;

  // Fetch payment method from Stripe
  let cardBrand: string | null = null;
  let cardLast4: string | null = null;
  let cardExpMonth: number | null = null;
  let cardExpYear: number | null = null;
  let stripeCustomerId: string | null = sub?.stripeCustomerId ?? null;

  if (stripeCustomerId) {
    try {
      const paymentMethods = await stripe.paymentMethods.list({
        customer: stripeCustomerId,
        type: "card",
        limit: 1,
      });
      const pm = paymentMethods.data[0];
      if (pm?.card) {
        cardBrand = pm.card.brand;
        cardLast4 = pm.card.last4;
        cardExpMonth = pm.card.exp_month;
        cardExpYear = pm.card.exp_year;
      }
    } catch {
      // Stripe not configured
    }
  }

  // Fetch invoices
  let invoices: Array<{
    id: string;
    number: string | null;
    amount: number;
    date: string;
    status: string;
    pdf: string | null;
  }> = [];

  if (stripeCustomerId) {
    try {
      const stripeInvoices = await stripe.invoices.list({
        customer: stripeCustomerId,
        limit: 10,
      });
      invoices = stripeInvoices.data.map((inv) => ({
        id: inv.id,
        number: inv.number,
        amount: inv.amount_paid / 100,
        date: new Date(inv.created * 1000).toLocaleDateString("de-AT"),
        status: inv.status ?? "unknown",
        pdf: inv.invoice_pdf ?? null,
      }));
    } catch {
      // Stripe not configured
    }
  }

  function formatCardBrand(brand: string) {
    const map: Record<string, string> = {
      visa: "Visa",
      mastercard: "Mastercard",
      amex: "American Express",
      discover: "Discover",
    };
    return map[brand] ?? brand.charAt(0).toUpperCase() + brand.slice(1);
  }

  return (
    <div>
      <h1 className="text-2xl font-bold text-gray-900 mb-6">Karte & Rechnungen</h1>

      <div className="space-y-5">
        {/* Payment Method */}
        <div className="bg-white border border-gray-200 rounded-xl p-6">
          <h2 className="text-base font-semibold text-gray-900 mb-4">Zahlungsmethoden</h2>

          {cardLast4 ? (
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-4">
                {/* Card icon */}
                <div className="h-10 w-16 bg-gradient-to-br from-orange-400 to-red-500 rounded-md flex items-center justify-center">
                  <span className="text-white text-xs font-bold">
                    {cardBrand === "visa" ? "VISA" : cardBrand === "mastercard" ? "MC" : cardBrand?.toUpperCase()}
                  </span>
                </div>
                <div>
                  <p className="text-sm font-medium text-gray-900">
                    {formatCardBrand(cardBrand ?? "")} endet auf {cardLast4}
                  </p>
                  <p className="text-xs text-gray-500 mt-0.5">
                    Läuft ab {String(cardExpMonth).padStart(2, "0")}/{cardExpYear}
                  </p>
                </div>
              </div>
              <PortalButton
                stripeCustomerId={stripeCustomerId}
                label="Karte ändern"
              />
            </div>
          ) : (
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3 text-gray-500">
                <CreditCard className="h-5 w-5" />
                <p className="text-sm">Keine Zahlungsmethode hinterlegt</p>
              </div>
              <PortalButton
                stripeCustomerId={stripeCustomerId}
                label="Karte hinzufügen"
              />
            </div>
          )}
        </div>

        {/* Billing Address */}
        <div className="bg-white border border-gray-200 rounded-xl p-6">
          <h2 className="text-base font-semibold text-gray-900 mb-1">Rechnungsinformationen</h2>
          <p className="text-xs text-gray-500 mb-5">
            Bestehende Rechnungen können nicht geändert werden – nur zukünftige Rechnungen sind betroffen.
          </p>
          <BillingAddressForm stripeCustomerId={stripeCustomerId} />
        </div>

        {/* Invoice History */}
        {invoices.length > 0 && (
          <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
            <div className="px-6 py-4 border-b border-gray-100">
              <h2 className="text-base font-semibold text-gray-900">Rechnungshistorie</h2>
            </div>
            <div className="divide-y divide-gray-100">
              {/* Table header */}
              <div className="grid grid-cols-[1fr_100px_100px_80px_80px] gap-4 px-6 py-2.5 bg-gray-50 text-xs font-semibold text-gray-500 uppercase tracking-wider">
                <span>Rechnungsnummer</span>
                <span>Datum</span>
                <span>Betrag</span>
                <span>Status</span>
                <span>PDF</span>
              </div>
              {invoices.map((inv) => (
                <div
                  key={inv.id}
                  className="grid grid-cols-[1fr_100px_100px_80px_80px] gap-4 px-6 py-3.5 items-center text-sm"
                >
                  <span className="text-gray-700 font-mono text-xs">{inv.number ?? inv.id}</span>
                  <span className="text-gray-700">{inv.date}</span>
                  <span className="text-gray-900 font-medium">€{inv.amount.toFixed(2)}</span>
                  <span
                    className={`text-xs font-medium ${
                      inv.status === "paid" ? "text-green-600" : "text-gray-500"
                    }`}
                  >
                    {inv.status === "paid" ? "Bezahlt" : inv.status}
                  </span>
                  {inv.pdf ? (
                    <a
                      href={inv.pdf}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-indigo-600 hover:underline text-xs"
                    >
                      PDF
                    </a>
                  ) : (
                    <span className="text-gray-400 text-xs">–</span>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
