import Link from "next/link";
import { Globe } from "lucide-react";

import { MarketingNav } from "@/components/marketing/marketing-nav";
import { PricingGrid } from "@/components/marketing/pricing-grid";
import {
  getMarketingPath,
  withLocalePrefix,
  type SiteLocale,
} from "@/lib/site-locale";

const PAGE_COPY = {
  en: {
    title: "Simple, fair pricing",
    description: "Start for free. No credit card required.",
    footerPrivacy: "Privacy",
    footerLegal: "Legal Notice",
    footerTerms: "Terms",
  },
  de: {
    title: "Einfache, faire Preise",
    description: "Kostenlos starten, keine Kreditkarte erforderlich.",
    footerPrivacy: "Datenschutz",
    footerLegal: "Impressum",
    footerTerms: "AGB",
  },
} as const;

type PricingPageProps = {
  locale: SiteLocale;
};

export function PricingPage({ locale }: PricingPageProps) {
  const copy = PAGE_COPY[locale];
  const homeHref = getMarketingPath(locale, "home");

  return (
    <div className="min-h-screen bg-white">
      <MarketingNav locale={locale} active="pricing" />

      <div className="px-4 pb-10 pt-16 text-center">
        <h1 className="mb-4 text-4xl font-extrabold text-gray-900 sm:text-5xl">
          {copy.title}
        </h1>
        <p className="text-lg text-gray-500">{copy.description}</p>
      </div>

      <PricingGrid locale={locale} />

      <footer className="mt-20 border-t border-gray-100 py-10">
        <div className="mx-auto flex max-w-7xl flex-col items-center justify-between gap-4 px-4 md:flex-row">
          <Link href={homeHref} className="flex items-center gap-2" aria-label="Deepglot">
            <Globe className="h-5 w-5 text-indigo-600" />
            <span className="font-semibold text-gray-900">Deepglot</span>
            <span className="ml-2 text-sm text-gray-400">
              © {new Date().getFullYear()} Andreas Ostheimer
            </span>
          </Link>
          <div className="flex gap-6 text-sm text-gray-400">
            <Link href={withLocalePrefix("/datenschutz", locale)} className="hover:text-gray-700">
              {copy.footerPrivacy}
            </Link>
            <Link href={withLocalePrefix("/impressum", locale)} className="hover:text-gray-700">
              {copy.footerLegal}
            </Link>
            <Link href={withLocalePrefix("/agb", locale)} className="hover:text-gray-700">
              {copy.footerTerms}
            </Link>
          </div>
        </div>
      </footer>
    </div>
  );
}
