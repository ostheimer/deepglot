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
    eyebrow: "Fair by design",
  },
  de: {
    title: "Einfache, faire Preise",
    description: "Kostenlos starten, keine Kreditkarte erforderlich.",
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
        <p className="mb-4 text-sm font-bold uppercase tracking-[0.18em] text-[#f03b22]">
          {copy.eyebrow}
        </p>
        <h1 className="mb-5 text-5xl font-extrabold tracking-[-0.05em] text-[#071521] sm:text-6xl">
          {copy.title}
        </h1>
        <p className="text-lg text-[#58636d]">{copy.description}</p>
      </div>

      <div className="pt-14">
        <PricingGrid locale={locale} viewer={viewer} />
      </div>

      <MarketingFooter locale={locale} />
    </div>
  );
}
