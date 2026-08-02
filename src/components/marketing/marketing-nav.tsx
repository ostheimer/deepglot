import Link from "next/link";

import { DeepglotLogo } from "@/components/brand/deepglot-logo";
import { Button } from "@/components/ui/button";
import { LanguageSwitcher } from "@/components/site/language-switcher";
import { getMarketingPath, type SiteLocale } from "@/lib/site-locale";
import { localizeCopy } from "@/lib/static-copy";

type MarketingNavProps = {
  locale: SiteLocale;
  active?: "home" | "pricing" | "docs" | "blog";
};

const NAV_COPY = {
  en: {
    features: "Features",
    pricing: "Pricing",
    plugin: "WordPress Plugin",
    docs: "Documentation",
    blog: "Blog",
    login: "Log in",
    signup: "Start free",
  },
  de: {
    features: "Features",
    pricing: "Preise",
    plugin: "WordPress Plugin",
    docs: "Dokumentation",
    blog: "Blog",
    login: "Anmelden",
    signup: "Kostenlos starten",
  },
} as const;

function navLinkClass(isActive: boolean) {
  return isActive
    ? "text-sm font-semibold text-[#c62812]"
    : "text-sm font-medium text-[#14212d] transition-colors hover:text-[#c62812]";
}

export function MarketingNav({ locale, active = "home" }: MarketingNavProps) {
  const copy = localizeCopy(locale, NAV_COPY);
  const homeHref = getMarketingPath(locale, "home");
  const pricingHref = getMarketingPath(locale, "pricing");
  const docsHref = getMarketingPath(locale, "docs");
  const blogHref = getMarketingPath(locale, "blog");
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
      <Link href={blogHref} className={navLinkClass(active === "blog")}>
        {copy.blog}
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
          <DeepglotLogo
            priority
            markClassName="h-10 w-10 lg:h-12 lg:w-12"
            wordmarkClassName="hidden text-xl min-[390px]:inline lg:text-2xl"
          />
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
            className="h-10 rounded-md bg-[#d92f19] px-4 font-semibold text-white shadow-none hover:bg-[#c62812] lg:h-12 lg:px-12"
          >
            <Link href={signupHref}>
              {copy.signup}
            </Link>
          </Button>
        </div>
      </div>
      <div className="border-t border-[#e8e8e3] px-5 py-3 lg:hidden">
        <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-center gap-x-5 gap-y-2 whitespace-nowrap">
          {navLinks}
          <div className="sm:hidden">
            <LanguageSwitcher compact />
          </div>
        </div>
      </div>
    </nav>
  );
}
