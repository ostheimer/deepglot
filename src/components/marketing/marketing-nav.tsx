import Link from "next/link";
import Image from "next/image";

import { Button } from "@/components/ui/button";
import { LanguageSwitcher } from "@/components/site/language-switcher";
import { getMarketingPath, type SiteLocale } from "@/lib/site-locale";
import { localizeCopy } from "@/lib/static-copy";

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
    ? "text-sm font-semibold text-[#f03b22]"
    : "text-sm font-medium text-[#14212d] transition-colors hover:text-[#f03b22]";
}

export function MarketingNav({ locale, active = "home" }: MarketingNavProps) {
  const copy = localizeCopy(locale, NAV_COPY);
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
    <nav className="sticky top-0 z-50 border-b border-[#e8e8e3] bg-[#fbfaf7]/92 backdrop-blur-xl">
      <div className="mx-auto flex h-20 max-w-[1488px] items-center justify-between px-5 sm:px-8 lg:h-24 lg:px-7">
        <Link
          href={homeHref}
          className="flex items-center gap-2.5"
          aria-label="Deepglot"
        >
          <Image
            src="/marketing/deepglot-mark.png"
            alt=""
            width={52}
            height={52}
            className="h-10 w-10 lg:h-12 lg:w-12"
            priority
          />
          <span className="text-xl font-extrabold tracking-[-0.035em] text-[#071521] lg:text-2xl">
            Deepglot
          </span>
        </Link>
        <div className="hidden items-center gap-7 lg:flex xl:gap-10">
          {navLinks}
        </div>
        <div className="flex items-center gap-3">
          <div className="hidden sm:block">
            <LanguageSwitcher compact />
          </div>
          <Button asChild variant="ghost" size="sm" className="hidden text-[#071521] hover:bg-[#f1f0eb] sm:inline-flex">
            <Link href={loginHref}>
              {copy.login}
            </Link>
          </Button>
          <Button
            asChild
            size="sm"
            className="h-10 rounded-md bg-[#f03b22] px-4 font-semibold text-white shadow-none hover:bg-[#d92f19] lg:h-12 lg:px-12"
          >
            <Link href={signupHref}>
              {copy.signup}
            </Link>
          </Button>
        </div>
      </div>
      <div className="border-t border-[#e8e8e3] px-5 py-3 lg:hidden">
        <div className="mx-auto flex max-w-7xl items-center gap-5 overflow-x-auto whitespace-nowrap">
          {navLinks}
          <div className="ml-auto sm:hidden">
            <LanguageSwitcher compact />
          </div>
        </div>
      </div>
    </nav>
  );
}
