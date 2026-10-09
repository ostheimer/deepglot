import { MarketingFooter } from "@/components/marketing/marketing-footer";
import { MarketingNav } from "@/components/marketing/marketing-nav";
import { PricingGrid } from "@/components/marketing/pricing-grid";
import { getViewerBillingContext } from "@/lib/billing-viewer";
import type { SiteLocale } from "@/lib/site-locale";
import { localizeCopy } from "@/lib/static-copy";

const PAGE_COPY = {
  en: {
    title: "Simple, fair pricing",
    description: "Start for free. No credit card required.",
    aiCosts: "Plan word quotas are separate from external AI provider charges. New provider spending requires explicit organization and project budget approvals; no credits or plan upgrades are purchased automatically.",
    eyebrow: "Fair by design",
  },
  de: {
    title: "Einfache, faire Preise",
    description: "Kostenlos starten, keine Kreditkarte erforderlich.",
    aiCosts: "Wortkontingente der Tarife sind von externen KI-Anbieterkosten getrennt. Neue Anbieteraufrufe benötigen ausdrücklich freigegebene Organisations- und Projektbudgets; Credits oder Tarif-Upgrades werden nie automatisch gekauft.",
    eyebrow: "Fair aus Prinzip",
  },
} as const;

type PricingPageProps = {
  locale: SiteLocale;
};

export async function PricingPage({ locale }: PricingPageProps) {
  const copy = localizeCopy(locale, PAGE_COPY);
  const viewer = await getViewerBillingContext();

  return (
    <div className="min-h-screen bg-[#f2f0ea] text-[#071521]">
      <MarketingNav locale={locale} active="pricing" />

      <div className="border-b border-[#d8d6ce] bg-[#fbfaf7] px-4 pb-14 pt-16 text-center sm:pt-20">
        <p className="mb-4 text-sm font-bold uppercase tracking-[0.18em] text-[#c62812]">
          {copy.eyebrow}
        </p>
        <h1 className="mb-5 text-5xl font-extrabold tracking-[-0.05em] text-[#071521] sm:text-6xl">
          {copy.title}
        </h1>
        <p className="text-lg text-[#58636d]">{copy.description}</p>
        <p className="mx-auto mt-4 max-w-3xl text-sm text-[#58636d]">{copy.aiCosts}</p>
      </div>

      <div className="pt-14">
        <PricingGrid locale={locale} viewer={viewer} />
      </div>

      <MarketingFooter locale={locale} />
    </div>
  );
}
