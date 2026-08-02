import Link from "next/link";

import { DeepglotLogo } from "@/components/brand/deepglot-logo";
import { getMarketingPath, type SiteLocale } from "@/lib/site-locale";
import { uiText } from "@/lib/static-copy";

export function MarketingFooter({ locale }: { locale: SiteLocale }) {
  return (
    <footer className="border-t border-[#d8d6ce] bg-[#071521] text-white">
      <div className="mx-auto grid max-w-[1488px] gap-10 px-5 py-12 sm:px-8 md:grid-cols-[1fr_auto] md:items-end lg:px-10 xl:px-14">
        <div>
          <Link
            href={getMarketingPath(locale, "home")}
            aria-label="Deepglot"
            className="inline-flex"
          >
            <DeepglotLogo
              markClassName="h-9 w-9"
              wordmarkClassName="text-white"
            />
          </Link>
          <p className="mt-4 max-w-md text-sm leading-6 text-white/60">
            {uiText(
              locale,
              "Deepglot gives you control over your translations again, with professional features at fair prices.",
              "Deepglot gibt dir die Kontrolle über deine Übersetzungen zurück, mit professionellen Features zu fairen Preisen."
            )}
          </p>
          <p className="mt-5 text-xs uppercase tracking-[0.16em] text-white/50">
            © {new Date().getFullYear()} Ostheimer OG · {uiText(locale, "Austria", "Österreich")}
          </p>
        </div>

        <nav
          aria-label="Footer"
          className="grid grid-cols-2 gap-x-8 gap-y-3 text-sm text-white/70 sm:grid-cols-3"
        >
          <Link className="transition-colors hover:text-[#f77a65]" href={getMarketingPath(locale, "blog")}>
            Blog
          </Link>
          <Link className="transition-colors hover:text-[#f77a65]" href={getMarketingPath(locale, "docs")}>
            {uiText(locale, "Documentation", "Dokumentation")}
          </Link>
          <a className="transition-colors hover:text-[#f77a65]" href="https://github.com/ostheimer/deepglot" target="_blank" rel="noreferrer">
            GitHub
          </a>
          <Link className="transition-colors hover:text-[#f77a65]" href={getMarketingPath(locale, "privacy")}>
            {uiText(locale, "Privacy", "Datenschutz")}
          </Link>
          <Link className="transition-colors hover:text-[#f77a65]" href={getMarketingPath(locale, "legalNotice")}>
            {uiText(locale, "Legal Notice", "Impressum")}
          </Link>
          <Link className="transition-colors hover:text-[#f77a65]" href={getMarketingPath(locale, "terms")}>
            {uiText(locale, "Terms", "AGB")}
          </Link>
        </nav>
      </div>
    </footer>
  );
}
