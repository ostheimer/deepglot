import Link from "next/link";
import { Globe } from "lucide-react";

import { Button } from "@/components/ui/button";
import { LanguageSwitcher } from "@/components/site/language-switcher";
import { getMarketingPath, type SiteLocale } from "@/lib/site-locale";

type MarketingNavProps = {
  locale: SiteLocale;
  active?: "home" | "pricing" | "docs";
};

const NAV_COPY = {
  en: {
    features: "Features",
    pricing: "Pricing",
    plugin: "WordPress Plugin",
    docs: "Documentation",
    login: "Log in",
    signup: "Start free",
  },
  de: {
    features: "Features",
    pricing: "Preise",
    plugin: "WordPress Plugin",
    docs: "Dokumentation",
    login: "Anmelden",
    signup: "Kostenlos starten",
  },
} as const;

function navLinkClass(isActive: boolean) {
  return isActive
    ? "text-sm font-medium text-indigo-600"
    : "text-sm text-gray-600 transition-colors hover:text-gray-900";
}

export function MarketingNav({ locale, active = "home" }: MarketingNavProps) {
  const copy = NAV_COPY[locale];
  const homeHref = getMarketingPath(locale, "home");
  const pricingHref = getMarketingPath(locale, "pricing");
  const docsHref = getMarketingPath(locale, "docs");
  const loginHref = getMarketingPath(locale, "login");
  const signupHref = getMarketingPath(locale, "signup");

  const navLinks = (
    <>
      <Link href={`${homeHref}#features`} className={navLinkClass(false)}>
        {copy.features}
      </Link>
      <Link href={pricingHref} className={navLinkClass(active === "pricing")}>
        {copy.pricing}
      </Link>
      <Link href={`${homeHref}#plugin`} className={navLinkClass(false)}>
        {copy.plugin}
      </Link>
      <Link href={docsHref} className={navLinkClass(active === "docs")}>
        {copy.docs}
      </Link>
    </>
  );

  return (
    <nav className="sticky top-0 z-50 border-b border-gray-100 bg-white/80 backdrop-blur-sm">
      <div className="mx-auto flex h-16 max-w-7xl items-center justify-between px-4 sm:px-6 lg:px-8">
        <Link
          href={homeHref}
          className="flex items-center gap-2"
          aria-label="Deepglot"
        >
          <Globe className="h-6 w-6 text-indigo-600" />
          <span className="text-xl font-bold text-gray-900">Deepglot</span>
        </Link>
        <div className="hidden items-center gap-8 md:flex">
          {navLinks}
        </div>
        <div className="flex items-center gap-3">
          <LanguageSwitcher compact />
          <Button asChild variant="ghost" size="sm">
            <Link href={loginHref}>
              {copy.login}
            </Link>
          </Button>
          <Button asChild size="sm" className="bg-indigo-600 hover:bg-indigo-700">
            <Link href={signupHref}>
              {copy.signup}
            </Link>
          </Button>
        </div>
      </div>
      <div className="border-t border-gray-100 px-4 py-3 md:hidden">
        <div className="mx-auto flex max-w-7xl gap-5 overflow-x-auto whitespace-nowrap">
          {navLinks}
        </div>
      </div>
    </nav>
  );
}
