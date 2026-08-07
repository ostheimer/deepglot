import Link from "next/link";
import {
  ArrowRight,
  ArrowsClockwise,
  Bell,
  Buildings,
  CheckCircle,
  Code,
  GithubLogo,
  GlobeHemisphereWest,
  HardDrives,
  Lightning,
  LockKey,
  ShieldCheck,
  Tag,
} from "@phosphor-icons/react/dist/ssr";

import { Button } from "@/components/ui/button";
import { HeroLanguagePreview } from "@/components/marketing/hero-language-preview";
import { MarketingFooter } from "@/components/marketing/marketing-footer";
import { MarketingNav } from "@/components/marketing/marketing-nav";
import { PricingGrid } from "@/components/marketing/pricing-grid";
import { getViewerBillingContext } from "@/lib/billing-viewer";
import { BILLING_PLANS } from "@/lib/billing-plans";
import { formatNumber } from "@/lib/locale-formatting";
import {
  getAustriaBrandLabel,
  getMarketingHeroLocale,
} from "@/lib/marketing-hero-locale";
import { splitMarketingHeroTitle } from "@/lib/marketing-hero-title";
import {
  formatCompactWords,
  getDateTimeFieldLabel,
} from "@/lib/marketing-formatting";
import { getMarketingPath, type SiteLocale } from "@/lib/site-locale";
import { localizeCopy, uiText } from "@/lib/static-copy";

const FEATURE_ICONS = {
  fast: Lightning,
  control: LockKey,
  model: GlobeHemisphereWest,
  plugin: Code,
  seo: CheckCircle,
  selfHosted: HardDrives,
  dynamic: ArrowsClockwise,
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
        title: "Fast pages, local translation cache",
        description:
          "Cold pages render without waiting for an AI provider. Deepglot translates missing content in the background, stores it locally, and purges supported page caches when it is ready.",
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
          "A proven output-buffer approach for Elementor, WooCommerce, Yoast SEO, and more — with synchronous editor and email output where a background retry cannot help.",
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
        title: "Schnelle Seiten, lokaler Übersetzungs-Cache",
        description:
          "Kalte Seiten rendern, ohne auf einen KI-Provider zu warten. Deepglot übersetzt fehlende Inhalte im Hintergrund, speichert sie lokal und leert unterstützte Seiten-Caches, sobald sie bereit sind.",
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
          "Bewährter Output-Buffer-Ansatz für Elementor, WooCommerce, Yoast SEO und mehr — mit synchronen Editor- und E-Mail-Ausgaben, wo eine spätere Hintergrundübersetzung nicht hilft.",
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
  const viewer = await getViewerBillingContext();
  const proWords = formatCompactWords(PRO_PLAN.wordsLimit, locale);
  const isGerman = locale === "de";
  const isEnglish = locale === "en";
  const heroLocale = getMarketingHeroLocale(locale);
  const heroDescription = isGerman
    ? "Deepglot übersetzt deinen WordPress-Content automatisch per KI. Deine Übersetzungen bleiben unter deiner Kontrolle."
    : isEnglish
      ? "Deepglot translates your WordPress content automatically with AI. Your translations stay under your control."
      : copy.heroDescription;
  const heroTitleParts = splitMarketingHeroTitle(copy.heroTitle, copy.heroHighlight);
  const proofItems = [
    {
      icon: LockKey,
      title: isGerman ? "Deine Daten" : copy.features[1].title,
      description: isGerman
        ? "Deine Inhalte bleiben bei dir. Keine Weitergabe, keine Überraschungen."
        : copy.features[1].description,
      tone: "signal" as const,
    },
    {
      icon: Code,
      title: "Open Source",
      description: isGerman
        ? "Transparenter Code, aktive Community, volles Vertrauen."
        : copy.features[5].description,
      tone: "mint" as const,
    },
    {
      icon: Tag,
      title: isGerman ? "Faire Preise" : copy.pricingHeading,
      description: isGerman
        ? "Klare Tarife, transparente Limits, volle Kostenkontrolle."
        : copy.featuresDescription,
      tone: "signal" as const,
    },
  ];

  return (
    <div className="min-h-screen bg-[#fbfaf7] text-[#071521]">
      <MarketingNav locale={locale} />

      <section className="overflow-hidden border-b border-[#e6e5df] bg-[#fbfaf7]">
        <div className="mx-auto grid min-h-[744px] max-w-[1488px] items-center gap-10 px-5 py-14 sm:px-8 lg:-mb-[18px] lg:grid-cols-[0.965fr_1.035fr] lg:items-start lg:gap-8 lg:px-10 lg:pb-0 lg:pt-10 xl:px-14">
          <div
            data-testid="marketing-hero-copy"
            className="relative z-10 max-w-[610px] lg:-translate-y-5 lg:py-8"
          >
            <p className="mb-5 text-sm font-bold tracking-[-0.01em] text-[#c62812] sm:text-base">
              {heroLocale.eyebrow}
            </p>
            <h1 className="max-w-full text-[3.25rem] font-extrabold leading-[0.98] tracking-[-0.055em] text-[#071521] [overflow-wrap:anywhere] hyphens-auto sm:text-[4rem] lg:text-[4rem] xl:text-[4.1rem]">
              {isGerman ? (
                <>
                  Deine Website
                  <br />
                  spricht jetzt mehr
                  <br />
                  als eine Sprache.
                  <br />
                  <span className="text-[#c62812]">Ohne Abo-Falle.</span>
                </>
              ) : isEnglish ? (
                <>
                  Your website speaks
                  <br />
                  more than one language.
                  <br />
                  <span className="text-[#c62812]">Without lock-in.</span>
                </>
              ) : (
                <>
                  {heroTitleParts.before}
                  {heroTitleParts.highlight ? (
                    <span className="text-[#c62812]">{heroTitleParts.highlight}</span>
                  ) : null}
                  {heroTitleParts.after}
                </>
              )}
            </h1>
            <p className="mt-4 max-w-[550px] text-lg leading-[1.58] text-[#4d5963] sm:text-xl">
              {heroDescription}
            </p>

            <div className="mt-6 flex flex-col gap-3 sm:flex-row">
              <Button
                asChild
                size="lg"
                className="h-14 rounded-[4px] bg-[#d92f19] px-12 text-base font-bold text-white shadow-none hover:bg-[#c62812]"
              >
                <Link href={signupHref}>
                  {copy.heroPrimaryCta}
                  <ArrowRight className="ml-3 h-5 w-5" weight="bold" />
                </Link>
              </Button>
              <Button
                asChild
                size="lg"
                variant="outline"
                className="h-14 rounded-[4px] border-[#17242e] bg-transparent px-12 text-base font-bold text-[#071521] shadow-none hover:bg-[#071521] hover:text-white"
              >
                <Link href="https://github.com/ostheimer/deepglot" target="_blank">
                  <GithubLogo className="mr-3 h-5 w-5" weight="fill" />
                  {copy.heroSecondaryCta}
                </Link>
              </Button>
            </div>

            <p className="mt-4 flex items-center gap-2 text-sm font-medium text-[#4d5963]">
              <CheckCircle className="h-5 w-5 shrink-0 text-[#42bfa2]" weight="bold" />
              {heroFooter}
            </p>

            <p className="ml-5 mt-12 flex items-center gap-3 text-sm font-bold text-[#c62812]">
              <Buildings className="h-7 w-7" weight="regular" />
              {getAustriaBrandLabel(locale)}
            </p>
          </div>

          <div data-testid="marketing-hero-showcase" className="min-w-0 lg:self-center lg:-translate-y-5">
            <HeroLanguagePreview locale={locale} />
          </div>
        </div>
      </section>

      <section className="bg-[#061827] text-white">
        <div className="mx-auto grid max-w-[1488px] divide-y divide-white/25 px-5 sm:px-8 md:grid-cols-3 md:divide-x md:divide-y-0 lg:px-10 xl:px-14">
          {proofItems.map((item) => (
            <div key={item.title} className="flex min-h-44 items-start gap-5 py-9 md:px-8 md:py-11 md:first:pl-0 md:last:pr-0">
              <item.icon
                className={item.tone === "mint" ? "h-10 w-10 shrink-0 text-[#42c5a4]" : "h-10 w-10 shrink-0 text-[#c62812]"}
                weight="regular"
              />
              <div className="min-w-0">
                <h2 className="text-2xl font-bold tracking-[-0.035em] [overflow-wrap:anywhere] hyphens-auto">{item.title}</h2>
                <p className="mt-3 max-w-sm text-sm leading-6 text-white/70">{item.description}</p>
              </div>
            </div>
          ))}
        </div>
      </section>

      <section id="features" className="bg-white py-24 sm:py-28">
        <div className="mx-auto max-w-7xl px-5 sm:px-8 lg:px-10">
          <div className="mb-14 grid gap-5 md:grid-cols-[0.8fr_1.2fr] md:items-end">
            <p className="text-sm font-bold uppercase tracking-[0.16em] text-[#c62812]">
              WordPress-first
            </p>
            <div>
              <h2 className="text-4xl font-extrabold tracking-[-0.045em] text-[#071521] sm:text-5xl">
                {copy.featuresHeading}
              </h2>
              <p className="mt-5 max-w-2xl text-lg leading-8 text-[#58636d]">{copy.featuresDescription}</p>
            </div>
          </div>
          <div className="grid border-y border-[#d9dad7] md:grid-cols-2 lg:grid-cols-3">
            {copy.features.map((feature, index) => {
              const featureId = "id" in feature ? feature.id : undefined;

              return (
                <article
                  key={feature.title}
                  id={featureId}
                  className={`border-[#d9dad7] px-1 py-8 sm:px-6 ${
                    featureId ? "scroll-mt-28" : ""
                  } ${index < copy.features.length - 1 ? "border-b" : ""} md:border-b lg:border-r lg:[&:nth-child(3n)]:border-r-0`}
                >
                  <feature.icon className="h-7 w-7 text-[#c62812]" weight="regular" />
                  <h3 className="mt-6 text-xl font-bold tracking-[-0.025em] text-[#071521]">{feature.title}</h3>
                  <p className="mt-3 text-sm leading-6 text-[#58636d]">{feature.description}</p>
                </article>
              );
            })}
          </div>
        </div>
      </section>

      <section id="pricing" className="bg-[#f3f2ed] py-24">
        <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
          <div className="mb-12 text-center">
            <p className="mb-4 text-sm font-bold uppercase tracking-[0.16em] text-[#c62812]">{copy.badge}</p>
            <h2 className="text-4xl font-extrabold tracking-[-0.045em] text-[#071521]">{copy.pricingHeading}</h2>
            <p className="mt-4 text-sm font-semibold text-[#58636d]">
              {PRO_PLAN.name} · {formatMonthlyEuroPrice(PRO_PLAN_EUROS, locale)} · {proWords}
            </p>
          </div>
          {/*
            The dedicated /pricing page hosts the same slider component, so the
            home page reuses it instead of maintaining a separate teaser grid
            that would inevitably drift out of sync with the canonical pricing.
          */}
          <PricingGrid locale={locale} viewer={viewer} />
        </div>
      </section>

      <MarketingFooter locale={locale} />
    </div>
  );
}
