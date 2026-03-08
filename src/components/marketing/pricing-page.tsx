import Link from "next/link";
import { Globe } from "lucide-react";

import { PricingGrid } from "@/components/marketing/pricing-grid";
import { LanguageSwitcher } from "@/components/site/language-switcher";
import { getMarketingPath, type SiteLocale } from "@/lib/site-locale";

const PAGE_COPY = {
  en: {
    navFeatures: "Features",
    navPricing: "Pricing",
    navDocs: "Documentation",
    login: "Log in",
    signup: "Start free",
    title: "Simple, fair pricing",
    description: "Start for free. No credit card required.",
    footerPrivacy: "Privacy",
    footerLegal: "Legal Notice",
    footerTerms: "Terms",
  },
  de: {
    navFeatures: "Features",
    navPricing: "Preise",
    navDocs: "Dokumentation",
    login: "Anmelden",
    signup: "Kostenlos testen",
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
  const pricingHref = getMarketingPath(locale, "pricing");
  const loginHref = getMarketingPath(locale, "login");
  const signupHref = getMarketingPath(locale, "signup");

  return (
    <div className="min-h-screen bg-white">
      <nav className="sticky top-0 z-50 border-b border-gray-100 bg-white/80 backdrop-blur-sm">
        <div className="mx-auto flex h-16 max-w-7xl items-center justify-between px-4 sm:px-6 lg:px-8">
          <Link href={homeHref} className="flex items-center gap-2">
            <Globe className="h-6 w-6 text-indigo-600" />
            <span className="text-xl font-bold text-gray-900">Deepglot</span>
          </Link>
          <div className="hidden items-center gap-8 md:flex">
            <Link href={`${homeHref}#features`} className="text-sm text-gray-600 hover:text-gray-900">
              {copy.navFeatures}
            </Link>
            <Link href={pricingHref} className="text-sm font-medium text-indigo-600">
              {copy.navPricing}
            </Link>
            <Link href="/docs" className="text-sm text-gray-600 hover:text-gray-900">
              {copy.navDocs}
            </Link>
          </div>
          <div className="flex items-center gap-3">
            <LanguageSwitcher compact />
            <Link href={loginHref} className="px-3 py-1.5 text-sm font-medium text-gray-600 hover:text-gray-900">
              {copy.login}
            </Link>
            <Link href={signupHref}>
              <button className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-indigo-700">
                {copy.signup}
              </button>
            </Link>
          </div>
        </div>
      </nav>

      <div className="px-4 pb-10 pt-16 text-center">
        <h1 className="mb-4 text-4xl font-extrabold text-gray-900 sm:text-5xl">
          {copy.title}
        </h1>
        <p className="text-lg text-gray-500">{copy.description}</p>
      </div>

      <PricingGrid locale={locale} />

      <footer className="mt-20 border-t border-gray-100 py-10">
        <div className="mx-auto flex max-w-7xl flex-col items-center justify-between gap-4 px-4 md:flex-row">
          <div className="flex items-center gap-2">
            <Globe className="h-5 w-5 text-indigo-600" />
            <span className="font-semibold text-gray-900">Deepglot</span>
            <span className="ml-2 text-sm text-gray-400">
              © {new Date().getFullYear()} Andreas Ostheimer
            </span>
          </div>
          <div className="flex gap-6 text-sm text-gray-400">
            <Link href="/datenschutz" className="hover:text-gray-700">
              {copy.footerPrivacy}
            </Link>
            <Link href="/impressum" className="hover:text-gray-700">
              {copy.footerLegal}
            </Link>
            <Link href="/agb" className="hover:text-gray-700">
              {copy.footerTerms}
            </Link>
          </div>
        </div>
      </footer>
    </div>
  );
}
