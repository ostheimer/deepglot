import Link from "next/link";

import { MarketingFooter } from "@/components/marketing/marketing-footer";
import { MarketingNav } from "@/components/marketing/marketing-nav";
import { getRequestLocale } from "@/lib/request-locale";
import { getMarketingPath } from "@/lib/site-locale";
import { uiText } from "@/lib/static-copy";

export default async function NotFound() {
  const locale = await getRequestLocale();

  return (
    <div className="flex min-h-screen flex-col bg-[#fbfaf7] text-[#071521]">
      <MarketingNav locale={locale} />
      <main className="flex flex-1 items-center">
        <div className="mx-auto grid w-full max-w-[1488px] gap-10 px-5 py-20 sm:px-8 lg:grid-cols-[220px_1fr] lg:px-10 xl:px-14">
          <p className="text-[9rem] font-extrabold leading-none tracking-[-0.08em] text-[#c62812] sm:text-[12rem]">404</p>
          <div className="max-w-2xl border-l border-[#d8d6ce] pl-8 lg:pl-12">
            <p className="text-sm font-bold uppercase tracking-[0.18em] text-[#c62812]">
              {uiText(locale, "Lost in translation", "Bei der Übersetzung verloren")}
            </p>
            <h1 className="mt-5 text-5xl font-extrabold leading-[1.02] tracking-[-0.05em]">
              {uiText(locale, "This page does not exist.", "Diese Seite gibt es nicht.")}
            </h1>
            <p className="mt-6 text-lg leading-8 text-[#58636d]">
              {uiText(locale, "The link may be outdated or the address may contain a typo.", "Der Link ist möglicherweise veraltet oder die Adresse enthält einen Tippfehler.")}
            </p>
            <Link href={getMarketingPath(locale, "home")} className="mt-8 inline-flex h-12 items-center bg-[#d92f19] px-6 font-bold text-white transition-colors hover:bg-[#c62812]">
              {uiText(locale, "Back to homepage", "Zurück zur Startseite")} →
            </Link>
          </div>
        </div>
      </main>
      <MarketingFooter locale={locale} />
    </div>
  );
}
