import Link from "next/link";
import { ArrowRight, Bell, Check, Code, Globe, Lock, RefreshCw, ShieldCheck, Zap } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { MarketingNav } from "@/components/marketing/marketing-nav";
import { PricingGrid } from "@/components/marketing/pricing-grid";
import { getViewerBillingContext } from "@/lib/billing-viewer";
import { BILLING_PLANS } from "@/lib/billing-plans";
import { formatNumber } from "@/lib/locale-formatting";
import {
  formatCompactWords,
  getDateTimeFieldLabel,
} from "@/lib/marketing-formatting";
import { getMarketingPath, type SiteLocale } from "@/lib/site-locale";
import { localizeCopy, uiText } from "@/lib/static-copy";

const FEATURE_ICONS = {
  fast: Zap,
  control: Lock,
  model: Globe,
  plugin: Code,
  seo: Check,
  selfHosted: Globe,
  dynamic: RefreshCw,
  botProtection: ShieldCheck,
  quotaVisibility: Bell,
} as const;

const PRO_PLAN = BILLING_PLANS.PRO;
const PRO_PLAN_EUROS = Math.round((PRO_PLAN.monthlyPriceCents ?? 0) / 100);

function formatMonthlyEuroPrice(amount: number, locale: SiteLocale): string {
  return `EUR ${amount}/${getDateTimeFieldLabel(locale, "month")}`;
}

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
    comparison: [
      { label: "Typical SaaS solution", highlight: false },
      { label: "Deepglot", highlight: true },
    ],
    comparisonBadge: "30% off the same volume",
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
        icon: FEATURE_ICONS.model,
        title: "Provider-flexible AI output",
        description:
          "High-quality translations powered by current OpenAI models by default, with OpenRouter, Ollama, OpenAI-compatible gateways, and optional DeepL support.",
      },
      {
        id: "plugin",
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
      {
        icon: FEATURE_ICONS.dynamic,
        title: "Dynamic content translation",
        description:
          "An optional client-side layer re-translates AJAX, infinite-scroll, and SPA content after page load — through a same-origin proxy, so your API key never reaches the browser and crawlers keep seeing server-rendered HTML.",
      },
      {
        icon: FEATURE_ICONS.botProtection,
        title: "Bot traffic protection",
        description:
          "Known crawlers are detected and served from the translation cache without spending your word quota — your monthly words are reserved for human visitors.",
      },
      {
        icon: FEATURE_ICONS.quotaVisibility,
        title: "Quota transparency",
        description:
          "Dashboard warnings at 90% and 100% of your monthly words, a proactive email to the organization owner, and a WordPress admin notice — you know before translations pause, not after.",
      },
    ],
    pricingHeading: "Transparent pricing. No surprises.",
    footer: {
      privacy: "Privacy",
      legal: "Legal Notice",
      terms: "Terms",
      github: "GitHub",
    },
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
    comparison: [
      { label: "Typische SaaS-Lösung", highlight: false },
      { label: "Deepglot", highlight: true },
    ],
    comparisonBadge: "30% günstiger bei gleicher Wortmenge",
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
        icon: FEATURE_ICONS.model,
        title: "Flexible KI-Qualität",
        description:
          "Hochwertige Übersetzungen standardmäßig mit aktuellen OpenAI-Modellen, optional über OpenRouter, Ollama, OpenAI-kompatible Gateways oder DeepL.",
      },
      {
        id: "plugin",
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
      {
        icon: FEATURE_ICONS.dynamic,
        title: "Dynamische Inhalte übersetzen",
        description:
          "Eine optionale Client-Schicht übersetzt AJAX-, Infinite-Scroll- und SPA-Inhalte nach dem Laden — über einen Same-Origin-Proxy, dein API-Key erreicht nie den Browser und Crawler sehen weiter serverseitig gerendertes HTML.",
      },
      {
        icon: FEATURE_ICONS.botProtection,
        title: "Bot-Traffic-Schutz",
        description:
          "Bekannte Crawler werden erkannt und aus dem Übersetzungs-Cache bedient, ohne dein Wort-Kontingent zu verbrauchen — deine monatlichen Wörter bleiben für echte Besucher reserviert.",
      },
      {
        icon: FEATURE_ICONS.quotaVisibility,
        title: "Kontingent-Transparenz",
        description:
          "Dashboard-Warnungen bei 90 % und 100 % deiner monatlichen Wörter, eine proaktive E-Mail an den Organisations-Inhaber und ein Hinweis im WordPress-Admin — du erfährst es, bevor Übersetzungen pausieren, nicht danach.",
      },
    ],
    pricingHeading: "Transparente Preise. Keine Überraschungen.",
    footer: {
      privacy: "Datenschutz",
      legal: "Impressum",
      terms: "AGB",
      github: "GitHub",
    },
  },
} as const;

type MarketingHomeProps = {
  locale: SiteLocale;
};

function buildHeroFooter(locale: SiteLocale): string {
  const freeWords = formatNumber(BILLING_PLANS.FREE.wordsLimit, locale);
  return uiText(
    locale,
    "{words} words/month for free · No credit card required",
    "{words} Wörter/Monat kostenlos · Keine Kreditkarte erforderlich"
  ).replace("{words}", freeWords);
}

export async function MarketingHome({ locale }: MarketingHomeProps) {
  const copy = localizeCopy(locale, MARKETING_COPY);
  const heroFooter = buildHeroFooter(locale);
  const signupHref = getMarketingPath(locale, "signup");
  const comparisonWords = formatCompactWords(PRO_PLAN.wordsLimit, locale);
  const viewer = await getViewerBillingContext();

  return (
    <div className="min-h-screen bg-white">
      <MarketingNav locale={locale} />

      <section className="mx-auto max-w-7xl px-4 pb-20 pt-24 sm:px-6 lg:px-8">
        <div className="mx-auto max-w-4xl text-center">
          <Badge variant="secondary" className="mb-6 border-indigo-200 bg-indigo-50 text-indigo-700">
            {copy.badge}
          </Badge>
          <h1 className="mb-6 text-5xl font-bold tracking-tight text-gray-900 sm:text-6xl">
            {copy.heroTitle.replace(copy.heroHighlight, "").trim()}{" "}
            <span className="text-indigo-600">{copy.heroHighlight}</span>
          </h1>
          <p className="mx-auto mb-10 max-w-2xl text-xl leading-relaxed text-gray-600">
            {copy.heroDescription}
          </p>
          <div className="flex flex-col items-center justify-center gap-4 sm:flex-row">
            <Button asChild size="lg" className="bg-indigo-600 px-8 text-base hover:bg-indigo-700">
              <Link href={signupHref}>
                {copy.heroPrimaryCta}
                <ArrowRight className="ml-2 h-4 w-4" />
              </Link>
            </Button>
            <Button asChild size="lg" variant="outline" className="px-8 text-base">
              <Link href="https://github.com/ostheimer/deepglot" target="_blank">
                <Code className="mr-2 h-4 w-4" />
                {copy.heroSecondaryCta}
              </Link>
            </Button>
          </div>
          <p className="mt-4 text-sm text-gray-500">{heroFooter}</p>
        </div>
      </section>

      <section className="bg-gray-50 py-12">
        <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
          <div className="grid grid-cols-2 gap-6 text-center md:grid-cols-4">
            {copy.comparison.map((item) => {
              const price = item.highlight
                ? formatMonthlyEuroPrice(PRO_PLAN_EUROS, locale)
                : uiText(locale, "from EUR 99/month", "ab EUR 99/Monat");
              const label = item.highlight
                ? `${item.label} ${PRO_PLAN.name}`
                : item.label;

              return (
                <div
                  key={label}
                  className={`col-span-2 rounded-xl p-6 ${
                    item.highlight
                      ? "bg-indigo-600 text-white"
                      : "border border-gray-200 bg-white text-gray-900"
                  }`}
                >
                  <p className={`mb-2 text-sm font-medium ${item.highlight ? "text-indigo-200" : "text-gray-500"}`}>
                    {label}
                  </p>
                  <p className="mb-1 text-3xl font-bold">{price}</p>
                  <p className={`text-sm ${item.highlight ? "text-indigo-200" : "text-gray-500"}`}>
                    {comparisonWords}
                  </p>
                  {item.highlight && (
                    <Badge className="mt-3 bg-white text-indigo-600">{copy.comparisonBadge}</Badge>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      </section>

      <section id="features" className="mx-auto max-w-7xl px-4 py-24 sm:px-6 lg:px-8">
        <div className="mb-16 text-center">
          <h2 className="mb-4 text-3xl font-bold text-gray-900">{copy.featuresHeading}</h2>
          <p className="mx-auto max-w-2xl text-lg text-gray-600">{copy.featuresDescription}</p>
        </div>
        <div className="grid grid-cols-1 gap-8 md:grid-cols-2 lg:grid-cols-3">
          {copy.features.map((feature) => {
            const featureId = "id" in feature ? feature.id : undefined;

            return (
              <Card
                key={feature.title}
                id={featureId}
                className={`border-gray-100 transition-shadow hover:shadow-md ${
                  featureId ? "scroll-mt-24" : ""
                }`}
              >
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
            );
          })}
        </div>
      </section>

      <section id="pricing" className="bg-gray-50 py-24">
        <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
          <div className="mb-12 text-center">
            <h2 className="text-3xl font-bold text-gray-900">{copy.pricingHeading}</h2>
          </div>
          {/*
            The dedicated /pricing page hosts the same slider component, so the
            home page reuses it instead of maintaining a separate teaser grid
            that would inevitably drift out of sync with the canonical pricing.
          */}
          <PricingGrid locale={locale} viewer={viewer} />
        </div>
      </section>

      <footer className="border-t border-gray-100 py-12">
        <div className="mx-auto flex max-w-7xl flex-col items-center justify-between gap-4 px-4 md:flex-row sm:px-6 lg:px-8">
          <Link
            href={getMarketingPath(locale, "home")}
            className="flex items-center gap-2"
            aria-label="Deepglot"
          >
            <Globe className="h-5 w-5 text-indigo-600" />
            <span className="font-semibold text-gray-900">Deepglot</span>
            <span className="ml-2 text-sm text-gray-500">
              © {new Date().getFullYear()} Andreas Ostheimer
            </span>
          </Link>
          <div className="flex gap-6 text-sm text-gray-500">
            <Link
              href={getMarketingPath(locale, "privacy")}
              className="transition-colors hover:text-gray-900"
            >
              {copy.footer.privacy}
            </Link>
            <Link
              href={getMarketingPath(locale, "legalNotice")}
              className="transition-colors hover:text-gray-900"
            >
              {copy.footer.legal}
            </Link>
            <Link
              href={getMarketingPath(locale, "terms")}
              className="transition-colors hover:text-gray-900"
            >
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
