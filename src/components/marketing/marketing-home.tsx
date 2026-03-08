import Link from "next/link";
import { ArrowRight, Check, Code, Globe, Lock, Zap } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { LanguageSwitcher } from "@/components/site/language-switcher";
import { PLANS, type PlanKey } from "@/lib/stripe";
import { getMarketingPath, type SiteLocale } from "@/lib/site-locale";

const FEATURE_ICONS = {
  fast: Zap,
  control: Lock,
  deepl: Globe,
  plugin: Code,
  seo: Check,
  selfHosted: Globe,
} as const;

const MARKETING_COPY = {
  en: {
    nav: {
      features: "Features",
      pricing: "Pricing",
      plugin: "WordPress Plugin",
      docs: "Documentation",
      login: "Log in",
      signup: "Start free",
    },
    badge: "Open Source · No lock-in · WordPress-first",
    heroTitle: "Translate your WordPress site without subscription lock-in",
    heroHighlight: "without subscription lock-in",
    heroDescription:
      "Deepglot translates your WordPress content automatically with AI at a fraction of the usual cost. Your translations stay yours.",
    heroPrimaryCta: "Get started for free",
    heroSecondaryCta: "View on GitHub",
    heroFooter: "10,000 words/month for free · No credit card required",
    comparison: [
      { label: "Typical SaaS solution", price: "from EUR 99/month", words: "200k words", highlight: false },
      { label: "Deepglot Professional", price: "EUR 49/month", words: "1M words", highlight: true },
    ],
    comparisonBadge: "5x more for half the price",
    featuresHeading: "Everything you need. Nothing that traps you.",
    featuresDescription:
      "Deepglot gives you control over your translations again, with professional features at fair prices.",
    features: [
      {
        icon: FEATURE_ICONS.fast,
        title: "Fast translation pipeline",
        description:
          "All strings from a page in one API request, with low latency through batching and local caching.",
      },
      {
        icon: FEATURE_ICONS.control,
        title: "Your data, your control",
        description:
          "Translations are stored in your own database. No lock-in, exportable at any time.",
      },
      {
        icon: FEATURE_ICONS.deepl,
        title: "DeepL-quality output",
        description:
          "High-quality translations powered by DeepL, with optional OpenAI support for context-sensitive content.",
      },
      {
        icon: FEATURE_ICONS.plugin,
        title: "WordPress-first plugin",
        description:
          "A proven output-buffer approach with strong compatibility for Elementor, WooCommerce, Yoast SEO, and more.",
      },
      {
        icon: FEATURE_ICONS.seo,
        title: "SEO-ready",
        description:
          "Automatic hreflang tags, subdirectory URLs such as /de/ and /fr/, and sitemap translation for maximum visibility.",
      },
      {
        icon: FEATURE_ICONS.selfHosted,
        title: "Self-hosted option",
        description:
          "Run the full backend yourself with Docker when you need maximum data ownership and cost control.",
      },
    ],
    pricingHeading: "Transparent pricing. No surprises.",
    featuredPlanBadge: "Recommended",
    freeLabel: "Free",
    monthlySuffix: "/month",
    planPrimaryCta: "Choose plan",
    planFreeCta: "Start free",
    footer: {
      privacy: "Privacy",
      legal: "Legal Notice",
      terms: "Terms",
      github: "GitHub",
    },
    planFeatures: {
      FREE: ["10,000 words/month", "1 project", "2 languages", "Community support"],
      STARTER: ["200,000 words/month", "5 projects", "10 languages", "Email support", "DeepL quality"],
      PROFESSIONAL: [
        "1,000,000 words/month",
        "Unlimited projects",
        "All languages",
        "Priority support",
        "DeepL + OpenAI",
        "Visual editor",
      ],
      ENTERPRISE: [
        "10,000,000 words/month",
        "Everything in Professional",
        "Dedicated support",
        "SLA",
        "Custom integrations",
      ],
    } satisfies Record<PlanKey, string[]>,
  },
  de: {
    nav: {
      features: "Features",
      pricing: "Preise",
      plugin: "WordPress Plugin",
      docs: "Dokumentation",
      login: "Anmelden",
      signup: "Kostenlos starten",
    },
    badge: "Open Source · Kein Lock-in · WordPress-first",
    heroTitle: "Übersetze deine WordPress-Site ohne Abo-Falle",
    heroHighlight: "ohne Abo-Falle",
    heroDescription:
      "Deepglot übersetzt deinen WordPress-Content automatisch per KI zu einem Bruchteil der üblichen Kosten. Übersetzungen gehören dir, nicht uns.",
    heroPrimaryCta: "Kostenlos loslegen",
    heroSecondaryCta: "GitHub ansehen",
    heroFooter: "10.000 Wörter/Monat kostenlos · Keine Kreditkarte erforderlich",
    comparison: [
      { label: "Typische SaaS-Lösung", price: "ab EUR 99/Monat", words: "200k Wörter", highlight: false },
      { label: "Deepglot Professional", price: "EUR 49/Monat", words: "1 Mio. Wörter", highlight: true },
    ],
    comparisonBadge: "5x mehr für die Hälfte",
    featuresHeading: "Alles was du brauchst. Nichts was dich fesselt.",
    featuresDescription:
      "Deepglot gibt dir die Kontrolle über deine Übersetzungen zurück, mit professionellen Features zu fairen Preisen.",
    features: [
      {
        icon: FEATURE_ICONS.fast,
        title: "Blitzschnelle Übersetzung",
        description:
          "Alle Strings einer Seite in einem API-Call, mit minimaler Latenz durch intelligentes Batching und lokalen Cache.",
      },
      {
        icon: FEATURE_ICONS.control,
        title: "Deine Daten, deine Kontrolle",
        description:
          "Übersetzungen werden in deiner eigenen Datenbank gespeichert. Kein Lock-in, jederzeit exportierbar.",
      },
      {
        icon: FEATURE_ICONS.deepl,
        title: "DeepL-Qualität",
        description:
          "Die beste verfügbare Übersetzungsqualität powered by DeepL, optional mit OpenAI für kontextsensitive Inhalte.",
      },
      {
        icon: FEATURE_ICONS.plugin,
        title: "WordPress Plugin",
        description:
          "Bewährter ob_start-Ansatz für hohe Kompatibilität mit Elementor, WooCommerce, Yoast SEO und mehr.",
      },
      {
        icon: FEATURE_ICONS.seo,
        title: "SEO-optimiert",
        description:
          "Automatische hreflang-Tags, Subdirectory-URLs wie /de/ und /fr/, sowie Sitemap-Übersetzung für maximale Sichtbarkeit.",
      },
      {
        icon: FEATURE_ICONS.selfHosted,
        title: "Self-hosted Option",
        description:
          "Für maximale Datenkontrolle kannst du das gesamte Backend per Docker selbst hosten.",
      },
    ],
    pricingHeading: "Transparente Preise. Keine Überraschungen.",
    featuredPlanBadge: "Empfohlen",
    freeLabel: "Kostenlos",
    monthlySuffix: "/Monat",
    planPrimaryCta: "Plan wählen",
    planFreeCta: "Kostenlos starten",
    footer: {
      privacy: "Datenschutz",
      legal: "Impressum",
      terms: "AGB",
      github: "GitHub",
    },
    planFeatures: {
      FREE: ["10.000 Wörter/Monat", "1 Projekt", "2 Sprachen", "Community Support"],
      STARTER: ["200.000 Wörter/Monat", "5 Projekte", "10 Sprachen", "E-Mail Support", "DeepL Qualität"],
      PROFESSIONAL: [
        "1.000.000 Wörter/Monat",
        "Unbegrenzte Projekte",
        "Alle Sprachen",
        "Prioritäts-Support",
        "DeepL + OpenAI",
        "Visueller Editor",
      ],
      ENTERPRISE: [
        "10.000.000 Wörter/Monat",
        "Alles aus Professional",
        "Dedicated Support",
        "SLA",
        "Custom Integrationen",
      ],
    } satisfies Record<PlanKey, string[]>,
  },
} as const;

type MarketingHomeProps = {
  locale: SiteLocale;
};

export function MarketingHome({ locale }: MarketingHomeProps) {
  const copy = MARKETING_COPY[locale];
  const loginHref = getMarketingPath(locale, "login");
  const signupHref = getMarketingPath(locale, "signup");

  return (
    <div className="min-h-screen bg-white">
      <nav className="sticky top-0 z-50 border-b border-gray-100 bg-white/80 backdrop-blur-sm">
        <div className="mx-auto flex h-16 max-w-7xl items-center justify-between px-4 sm:px-6 lg:px-8">
          <div className="flex items-center gap-2">
            <Globe className="h-6 w-6 text-indigo-600" />
            <span className="text-xl font-bold text-gray-900">Deepglot</span>
          </div>
          <div className="hidden items-center gap-8 md:flex">
            <Link href={`${getMarketingPath(locale, "home")}#features`} className="text-sm text-gray-600 transition-colors hover:text-gray-900">
              {copy.nav.features}
            </Link>
            <Link href={getMarketingPath(locale, "pricing")} className="text-sm text-gray-600 transition-colors hover:text-gray-900">
              {copy.nav.pricing}
            </Link>
            <Link href={`${getMarketingPath(locale, "home")}#plugin`} className="text-sm text-gray-600 transition-colors hover:text-gray-900">
              {copy.nav.plugin}
            </Link>
            <Link href="/docs" className="text-sm text-gray-600 transition-colors hover:text-gray-900">
              {copy.nav.docs}
            </Link>
          </div>
          <div className="flex items-center gap-3">
            <LanguageSwitcher compact />
            <Link href={loginHref}>
              <Button variant="ghost" size="sm">
                {copy.nav.login}
              </Button>
            </Link>
            <Link href={signupHref}>
              <Button size="sm" className="bg-indigo-600 hover:bg-indigo-700">
                {copy.nav.signup}
              </Button>
            </Link>
          </div>
        </div>
      </nav>

      <section className="mx-auto max-w-7xl px-4 pb-20 pt-24 sm:px-6 lg:px-8">
        <div className="mx-auto max-w-4xl text-center">
          <Badge variant="secondary" className="mb-6 border-indigo-200 bg-indigo-50 text-indigo-700">
            {copy.badge}
          </Badge>
          <h1 className="mb-6 text-5xl font-bold tracking-tight text-gray-900 sm:text-6xl">
            {locale === "en" ? (
              <>
                Translate your WordPress site{" "}
                <span className="text-indigo-600">{copy.heroHighlight}</span>
              </>
            ) : (
              <>
                Übersetze deine WordPress-Site{" "}
                <span className="text-indigo-600">{copy.heroHighlight}</span>
              </>
            )}
          </h1>
          <p className="mx-auto mb-10 max-w-2xl text-xl leading-relaxed text-gray-600">
            {copy.heroDescription}
          </p>
          <div className="flex flex-col items-center justify-center gap-4 sm:flex-row">
            <Link href={signupHref}>
              <Button size="lg" className="bg-indigo-600 px-8 text-base hover:bg-indigo-700">
                {copy.heroPrimaryCta}
                <ArrowRight className="ml-2 h-4 w-4" />
              </Button>
            </Link>
            <Link href="https://github.com/ostheimer/deepglot" target="_blank">
              <Button size="lg" variant="outline" className="px-8 text-base">
                <Code className="mr-2 h-4 w-4" />
                {copy.heroSecondaryCta}
              </Button>
            </Link>
          </div>
          <p className="mt-4 text-sm text-gray-500">{copy.heroFooter}</p>
        </div>
      </section>

      <section className="bg-gray-50 py-12">
        <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
          <div className="grid grid-cols-2 gap-6 text-center md:grid-cols-4">
            {copy.comparison.map((item) => (
              <div
                key={item.label}
                className={`col-span-2 rounded-xl p-6 ${
                  item.highlight
                    ? "bg-indigo-600 text-white"
                    : "border border-gray-200 bg-white text-gray-900"
                }`}
              >
                <p className={`mb-2 text-sm font-medium ${item.highlight ? "text-indigo-200" : "text-gray-500"}`}>
                  {item.label}
                </p>
                <p className="mb-1 text-3xl font-bold">{item.price}</p>
                <p className={`text-sm ${item.highlight ? "text-indigo-200" : "text-gray-500"}`}>
                  {item.words}
                </p>
                {item.highlight && (
                  <Badge className="mt-3 bg-white text-indigo-600">{copy.comparisonBadge}</Badge>
                )}
              </div>
            ))}
          </div>
        </div>
      </section>

      <section id="features" className="mx-auto max-w-7xl px-4 py-24 sm:px-6 lg:px-8">
        <div className="mb-16 text-center">
          <h2 className="mb-4 text-3xl font-bold text-gray-900">{copy.featuresHeading}</h2>
          <p className="mx-auto max-w-2xl text-lg text-gray-600">{copy.featuresDescription}</p>
        </div>
        <div className="grid grid-cols-1 gap-8 md:grid-cols-2 lg:grid-cols-3">
          {copy.features.map((feature) => (
            <Card key={feature.title} className="border-gray-100 transition-shadow hover:shadow-md">
              <CardHeader>
                <div className="mb-3 flex h-10 w-10 items-center justify-center rounded-lg bg-indigo-50">
                  <feature.icon className="h-5 w-5 text-indigo-600" />
                </div>
                <CardTitle className="text-lg">{feature.title}</CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-sm text-gray-600">{feature.description}</p>
              </CardContent>
            </Card>
          ))}
        </div>
      </section>

      <section className="bg-gray-50 py-24">
        <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
          <div className="mb-16 text-center">
            <h2 className="text-3xl font-bold text-gray-900">{copy.pricingHeading}</h2>
          </div>
          <div className="grid grid-cols-1 gap-6 md:grid-cols-2 lg:grid-cols-4">
            {Object.entries(PLANS).map(([key, plan]) => {
              const localizedFeatures = copy.planFeatures[key as PlanKey];

              return (
                <Card
                  key={key}
                  className={`relative ${
                    key === "PROFESSIONAL"
                      ? "border-2 border-indigo-600 shadow-lg"
                      : "border-gray-200"
                  }`}
                >
                  {key === "PROFESSIONAL" && (
                    <div className="absolute left-1/2 top-0 -translate-x-1/2 -translate-y-1/2 transform">
                      <Badge className="bg-indigo-600 text-white">{copy.featuredPlanBadge}</Badge>
                    </div>
                  )}
                  <CardHeader>
                    <CardTitle className="text-lg">{plan.name}</CardTitle>
                    <div className="mt-2">
                      <span className="text-3xl font-bold">
                        {plan.priceMonthly === 0
                          ? copy.freeLabel
                          : `EUR ${(plan.priceMonthly / 100).toFixed(0)}`}
                      </span>
                      {plan.priceMonthly > 0 && (
                        <span className="text-sm text-gray-500">{copy.monthlySuffix}</span>
                      )}
                    </div>
                  </CardHeader>
                  <CardContent>
                    <ul className="mb-6 space-y-2">
                      {localizedFeatures.map((feature) => (
                        <li key={feature} className="flex items-center gap-2 text-sm text-gray-600">
                          <Check className="h-4 w-4 flex-shrink-0 text-green-500" />
                          {feature}
                        </li>
                      ))}
                    </ul>
                    <Link href={signupHref}>
                      <Button
                        className={`w-full ${
                          key === "PROFESSIONAL" ? "bg-indigo-600 hover:bg-indigo-700" : ""
                        }`}
                        variant={key === "PROFESSIONAL" ? "default" : "outline"}
                      >
                        {plan.priceMonthly === 0 ? copy.planFreeCta : copy.planPrimaryCta}
                      </Button>
                    </Link>
                  </CardContent>
                </Card>
              );
            })}
          </div>
        </div>
      </section>

      <footer className="border-t border-gray-100 py-12">
        <div className="mx-auto flex max-w-7xl flex-col items-center justify-between gap-4 px-4 md:flex-row sm:px-6 lg:px-8">
          <div className="flex items-center gap-2">
            <Globe className="h-5 w-5 text-indigo-600" />
            <span className="font-semibold text-gray-900">Deepglot</span>
            <span className="ml-2 text-sm text-gray-500">
              © {new Date().getFullYear()} Andreas Ostheimer
            </span>
          </div>
          <div className="flex gap-6 text-sm text-gray-500">
            <Link href="/datenschutz" className="transition-colors hover:text-gray-900">
              {copy.footer.privacy}
            </Link>
            <Link href="/impressum" className="transition-colors hover:text-gray-900">
              {copy.footer.legal}
            </Link>
            <Link href="/agb" className="transition-colors hover:text-gray-900">
              {copy.footer.terms}
            </Link>
            <Link
              href="https://github.com/ostheimer/deepglot"
              target="_blank"
              className="transition-colors hover:text-gray-900"
            >
              {copy.footer.github}
            </Link>
          </div>
        </div>
      </footer>
    </div>
  );
}
