import Link from "next/link";

import { MarketingNav } from "@/components/marketing/marketing-nav";
import { getMarketingPath, type SiteLocale } from "@/lib/site-locale";

type SimpleMarketingPageProps = {
  locale: SiteLocale;
  active?: "home" | "pricing" | "docs";
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
    <div className="min-h-screen bg-white">
      <MarketingNav locale={locale} active={active} />
      <main className="mx-auto max-w-4xl px-4 py-20 sm:px-6 lg:px-8">
        {eyebrow && (
          <p className="mb-4 text-sm font-semibold uppercase tracking-[0.2em] text-indigo-600">
            {eyebrow}
          </p>
        )}
        <h1 className="text-4xl font-bold tracking-tight text-gray-950 sm:text-5xl">
          {title}
        </h1>
        <p className="mt-6 text-lg leading-8 text-gray-600">{description}</p>

        <div className="mt-12 space-y-8">
          {sections.map((section) => (
            <section
              key={section.title}
              className="rounded-2xl border border-gray-200 bg-white p-6 shadow-sm"
            >
              <h2 className="text-xl font-semibold text-gray-950">
                {section.title}
              </h2>
              <p className="mt-3 leading-7 text-gray-600">{section.body}</p>
            </section>
          ))}
        </div>

        <div className="mt-12 rounded-2xl bg-gray-50 p-6 text-sm text-gray-600">
          <p>
            {locale === "de"
              ? "Fragen? Schreib uns unter "
              : "Questions? Contact us at "}
            <a
              href="mailto:office@ostheimer.at"
              className="font-medium text-indigo-600 hover:underline"
            >
              office@ostheimer.at
            </a>
            .
          </p>
          <p className="mt-4">
            <Link
              href={getMarketingPath(locale, "home")}
              className="font-medium text-indigo-600 hover:underline"
            >
              {locale === "de" ? "Zurück zur Startseite" : "Back to homepage"}
            </Link>
          </p>
        </div>
      </main>
    </div>
  );
}
