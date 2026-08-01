import Link from "next/link";
import { Buildings } from "@phosphor-icons/react/dist/ssr";

import { MarketingFooter } from "@/components/marketing/marketing-footer";
import { MarketingNav } from "@/components/marketing/marketing-nav";
import { getAustriaBrandLabel } from "@/lib/marketing-hero-locale";
import { getMarketingPath, type SiteLocale } from "@/lib/site-locale";
import { uiText } from "@/lib/static-copy";

type SimpleMarketingPageProps = {
  locale: SiteLocale;
  active?: "home" | "pricing" | "docs" | "blog";
  title: string;
  description: string;
  eyebrow?: string;
  sections: Array<{
    title: string;
    body: string;
  }>;
};

export function SimpleMarketingPage({
  locale,
  active = "home",
  title,
  description,
  eyebrow,
  sections,
}: SimpleMarketingPageProps) {
  return (
    <div className="min-h-screen bg-[#fbfaf7] text-[#071521]">
      <MarketingNav locale={locale} active={active} />
      <main>
        <header className="border-b border-[#d8d6ce] bg-[#f2f0ea]">
          <div className="mx-auto grid max-w-[1488px] gap-10 px-5 py-16 sm:px-8 lg:grid-cols-[minmax(0,1fr)_280px] lg:px-10 lg:py-24 xl:px-14">
            <div className="max-w-4xl">
              {eyebrow && (
                <p className="mb-5 text-sm font-bold uppercase tracking-[0.18em] text-[#c62812]">
                  {eyebrow}
                </p>
              )}
              <h1 className="text-5xl font-extrabold leading-[0.98] tracking-[-0.05em] text-[#071521] sm:text-6xl">
                {title}
              </h1>
              <p className="mt-7 max-w-3xl text-lg leading-8 text-[#58636d]">
                {description}
              </p>
            </div>
            <div className="hidden border-l border-[#c9c7be] pl-8 lg:flex lg:flex-col lg:justify-end">
              <Buildings className="h-10 w-10 text-[#c62812]" weight="regular" />
              <p className="mt-5 text-sm font-bold uppercase tracking-[0.14em] text-[#071521]">
                {getAustriaBrandLabel(locale)}
              </p>
              <p className="mt-2 text-sm leading-6 text-[#69737b]">
                {uiText(
                  locale,
                  "Clear terms, direct contact, no hidden layers.",
                  "Klare Bedingungen, direkter Kontakt, keine versteckten Ebenen."
                )}
              </p>
            </div>
          </div>
        </header>

        <div className="mx-auto max-w-5xl px-5 py-16 sm:px-8 lg:py-24">
          {sections.map((section) => (
            <section
              key={section.title}
              className="grid gap-4 border-t border-[#d8d6ce] py-8 first:border-t-0 first:pt-0 md:grid-cols-[minmax(180px,0.55fr)_1.45fr] md:gap-12"
            >
              <h2 className="text-lg font-bold tracking-[-0.02em] text-[#071521]">
                {section.title}
              </h2>
              <p className="leading-7 text-[#58636d]">{section.body}</p>
            </section>
          ))}

          <div className="mt-12 flex flex-col gap-4 border-l-4 border-[#f03b22] bg-white p-6 text-sm text-[#58636d] sm:flex-row sm:items-center sm:justify-between">
            <p>
              {uiText(locale, "Questions? Contact us at ", "Fragen? Schreib uns unter ")}
              <a href="mailto:office@ostheimer.at" className="font-bold text-[#c62812] hover:underline">
                office@ostheimer.at
              </a>
              .
            </p>
            <Link href={getMarketingPath(locale, "home")} className="font-bold text-[#071521] hover:text-[#c62812]">
              {uiText(locale, "Back to homepage", "Zurück zur Startseite")} →
            </Link>
          </div>
        </div>
      </main>
      <MarketingFooter locale={locale} />
    </div>
  );
}
