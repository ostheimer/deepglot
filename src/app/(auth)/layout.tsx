import Link from "next/link";
import { Buildings, CheckCircle } from "@phosphor-icons/react/dist/ssr";

import { DeepglotLogo } from "@/components/brand/deepglot-logo";
import { LanguageSwitcher } from "@/components/site/language-switcher";
import { getRequestLocale } from "@/lib/request-locale";
import { getMarketingPath } from "@/lib/site-locale";
import { uiText } from "@/lib/static-copy";

export default async function AuthLayout({ children }: { children: React.ReactNode }) {
  const locale = await getRequestLocale();

  return (
    <div className="flex min-h-screen flex-col bg-[#fbfaf7] text-[#071521]">
      <header className="flex items-center justify-between border-b border-[#d8d6ce] px-5 py-4 sm:px-8">
        <Link href={getMarketingPath(locale, "home")} className="flex items-center gap-2 w-fit">
          <DeepglotLogo markClassName="h-9 w-9" wordmarkClassName="text-lg" priority />
        </Link>
        <LanguageSwitcher compact />
      </header>
      <main className="grid flex-1 lg:grid-cols-[minmax(0,0.92fr)_minmax(420px,1.08fr)]">
        <section className="flex items-center justify-center px-4 py-12 sm:px-8">
          {children}
        </section>
        <aside className="relative hidden min-h-[720px] overflow-hidden border-l border-[#d8d6ce] bg-[#071521] lg:block">
          <div
            className="absolute inset-0 bg-cover bg-center opacity-65"
            style={{ backgroundImage: "url('/marketing/austrian-interior-hero.png')" }}
          />
          <div className="absolute inset-0 bg-[#071521]/55" />
          <div className="relative flex h-full flex-col justify-between p-12 text-white xl:p-16">
            <p className="flex items-center gap-3 text-sm font-bold uppercase tracking-[0.16em] text-[#f77a65]">
              <Buildings className="h-6 w-6" weight="regular" />
              {uiText(locale, "Built in Austria", "Entwickelt in Österreich")}
            </p>
            <div className="max-w-xl">
              <h1 className="text-5xl font-extrabold leading-[1.02] tracking-[-0.05em]">
                {uiText(
                  locale,
                  "Your languages. Your content. Your control.",
                  "Deine Sprachen. Deine Inhalte. Deine Kontrolle."
                )}
              </h1>
              <p className="mt-6 max-w-lg text-lg leading-8 text-white/75">
                {uiText(
                  locale,
                  "Translate WordPress with modern AI, transparent pricing and no subscription lock-in.",
                  "Übersetze WordPress mit moderner KI, transparenten Preisen und ohne Abo-Falle."
                )}
              </p>
              <p className="mt-8 flex items-center gap-2 text-sm font-semibold text-white/80">
                <CheckCircle className="h-5 w-5 text-[#42c5a4]" weight="fill" />
                {uiText(locale, "10,000 words per month free", "10.000 Wörter pro Monat kostenlos")}
              </p>
            </div>
          </div>
        </aside>
      </main>
    </div>
  );
}
