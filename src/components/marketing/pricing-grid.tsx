"use client";

import { useState } from "react";
import Link from "next/link";
import { Check } from "lucide-react";

import { toast } from "sonner";

import { getMarketingPath, type SiteLocale } from "@/lib/site-locale";
import { getIntlLocale } from "@/lib/locale-formatting";
import {
  formatCompactWordCount,
  getDateTimeFieldLabel,
} from "@/lib/marketing-formatting";
import { localizeCopy } from "@/lib/static-copy";
import {
  BILLING_PLANS,
  BILLING_PLAN_KEYS,
  computeYearlyTotalCents,
  formatYearlyMonthlyEquivalentCents,
  type BillingPlanKey,
} from "@/lib/billing-plans";
import { openBillingPortal, startCheckout } from "@/lib/billing-client";
import type { ViewerBillingContext } from "@/lib/billing-viewer";

/**
 * Marketing-friendly capabilities advertised per tier. Each cell mirrors the
 * same feature gating the comparison table previously used so customers see
 * exactly what they get when the slider lands on a tier — and nothing more.
 */
const PLAN_FEATURES: Record<
  BillingPlanKey,
  { en: string[]; de: string[] }
> = {
  FREE: {
    en: ["AI translation", "Glossary", "1 project · 1 language", "Community support"],
    de: ["KI-Übersetzung", "Glossar", "1 Projekt · 1 Sprache", "Community-Support"],
  },
  STARTER: {
    en: [
      "Everything in Free",
      "Media translation",
      "Auto-redirect for visitors",
      "Email support",
    ],
    de: [
      "Alles aus Free",
      "Medien-Übersetzung",
      "Auto-Weiterleitung für Besucher",
      "E-Mail-Support",
    ],
  },
  BUSINESS: {
    en: [
      "Everything in Starter",
      "Translation analytics",
      "3 projects · 3 languages",
      "Priority email support",
    ],
    de: [
      "Alles aus Starter",
      "Übersetzungs-Statistiken",
      "3 Projekte · 3 Sprachen",
      "Bevorzugter E-Mail-Support",
    ],
  },
  PRO: {
    en: [
      "Everything in Business",
      "Translated URL slugs",
      "Visual editor",
      "5 projects · 5 languages",
    ],
    de: [
      "Alles aus Business",
      "Übersetzte URL-Slugs",
      "Visueller Editor",
      "5 Projekte · 5 Sprachen",
    ],
  },
  ADVANCED: {
    en: [
      "Everything in Pro",
      "Import & export (CSV / PO)",
      "Custom AI provider",
      "10 projects · 10 languages",
    ],
    de: [
      "Alles aus Pro",
      "Import & Export (CSV / PO)",
      "Eigener KI-Provider",
      "10 Projekte · 10 Sprachen",
    ],
  },
  EXTENDED: {
    en: [
      "Everything in Advanced",
      "Top-level domain routing",
      "25 projects · 20 languages",
      "Premium support (SLA)",
    ],
    de: [
      "Alles aus Advanced",
      "Top-Level-Domain Routing",
      "25 Projekte · 20 Sprachen",
      "Premium-Support (SLA)",
    ],
  },
  ENTERPRISE: {
    en: [
      "Everything in Extended",
      "SAML SSO",
      "Dedicated contract (DPA)",
      "Custom integrations & SLA",
    ],
    de: [
      "Alles aus Extended",
      "SAML SSO",
      "Dedizierter Vertrag (DPA)",
      "Custom Integrationen & SLA",
    ],
  },
};

const PRICING_COPY = {
  en: {
    monthly: "Monthly",
    yearly: "Yearly",
    yearlySavings: "2 months free",
    enterprisePrice: "Custom pricing",
    primaryCta: "Start free",
    paidCta: "Try for free",
    enterpriseCta: "Contact sales",
    sliderLabel: "Translated words per month",
    wordsLabel: "words / month",
    yearlySavingsHint: "− 2 months free",
    billingToggleLabel: "Toggle yearly billing",
    sliderHint: "Drag the slider to find the plan that fits your monthly volume.",
    selectedTierBadge: "Selected plan",
    recommendedBadge: "Recommended",
    contactPrompt: "Need more? We design custom enterprise contracts.",
    faq: "Questions about the plans?",
    faqCta: "Talk to us",
    faqSuffix: "and we will help you choose the right setup.",
    currentPlan: "Current plan",
    managePlan: "Manage plan",
    upgradeCta: "Upgrade",
    redirecting: "Redirecting…",
    checkoutError: "Could not start checkout. Please try again.",
  },
  de: {
    monthly: "Monatlich",
    yearly: "Jährlich",
    yearlySavings: "2 Monate gratis",
    enterprisePrice: "Preis auf Anfrage",
    primaryCta: "Kostenlos starten",
    paidCta: "Kostenlos testen",
    enterpriseCta: "Kontakt aufnehmen",
    sliderLabel: "Übersetzte Wörter pro Monat",
    wordsLabel: "Wörter / Monat",
    yearlySavingsHint: "− 2 Monate gratis",
    billingToggleLabel: "Jährliche Abrechnung umschalten",
    sliderHint:
      "Schiebe den Regler bis zur Wortmenge die du brauchst — Preis und Features passen sich automatisch an.",
    selectedTierBadge: "Ausgewählter Plan",
    recommendedBadge: "Empfohlen",
    contactPrompt:
      "Brauchst du mehr? Wir bauen individuelle Enterprise-Verträge.",
    faq: "Fragen zu den Plänen?",
    faqCta: "Schreib uns",
    faqSuffix: "wir helfen gerne.",
    currentPlan: "Aktueller Plan",
    managePlan: "Plan verwalten",
    upgradeCta: "Upgraden",
    redirecting: "Weiterleiten…",
    checkoutError: "Checkout konnte nicht gestartet werden. Bitte erneut versuchen.",
  },
} as const;

/**
 * Singular / plural noun forms for the plan spec line ("2 languages · 2 projects"),
 * keyed by Unicode CLDR plural category. The render picks the category with
 * Intl.PluralRules(locale).select(count), so counts inflect correctly even where
 * a language has more than the English one/other split (e.g. Polish "5 jezykow",
 * Czech "5 jazyku", Slovenian dual "2 jezika"). Forms come from the
 * professionally translated plan feature bullets, so German keeps its capitalised
 * nouns and every other locale uses its natural lowercase form. "other" is always
 * present as the fallback when a count maps to a category not listed here.
 */
type PluralForms = Partial<Record<Intl.LDMLPluralRule, string>> & { other: string };

const PLAN_SPEC_NOUNS: Record<SiteLocale, { language: PluralForms; project: PluralForms }> = {
  en: { language: { one: "language", other: "languages" }, project: { one: "project", other: "projects" } },
  bg: { language: { one: "език", other: "езика" }, project: { one: "проект", other: "проекта" } },
  hr: { language: { one: "jezik", few: "jezika", other: "jezika" }, project: { one: "projekt", few: "projekta", other: "projekata" } },
  cs: { language: { one: "jazyk", few: "jazyky", other: "jazyků" }, project: { one: "projekt", few: "projekty", other: "projektů" } },
  da: { language: { one: "sprog", other: "sprog" }, project: { one: "projekt", other: "projekter" } },
  nl: { language: { one: "taal", other: "talen" }, project: { one: "project", other: "projecten" } },
  et: { language: { one: "keel", other: "keelt" }, project: { one: "projekt", other: "projekti" } },
  fi: { language: { one: "kieli", other: "kieltä" }, project: { one: "projekti", other: "projektia" } },
  fr: { language: { one: "langue", other: "langues" }, project: { one: "projet", other: "projets" } },
  de: { language: { one: "Sprache", other: "Sprachen" }, project: { one: "Projekt", other: "Projekte" } },
  el: { language: { one: "γλώσσα", other: "γλώσσες" }, project: { one: "έργο", other: "έργα" } },
  hu: { language: { one: "nyelv", other: "nyelv" }, project: { one: "projekt", other: "projekt" } },
  ga: { language: { one: "teanga", two: "theanga", few: "theanga", many: "dteanga", other: "teanga" }, project: { one: "tionscadal", two: "thionscadal", few: "thionscadal", many: "dtionscadal", other: "tionscadal" } },
  it: { language: { one: "lingua", other: "lingue" }, project: { one: "progetto", other: "progetti" } },
  lv: { language: { zero: "valodas", one: "valoda", other: "valodas" }, project: { zero: "projekti", one: "projekts", other: "projekti" } },
  lt: { language: { one: "kalba", few: "kalbos", other: "kalbų" }, project: { one: "projektas", few: "projektai", other: "projektų" } },
  mt: { language: { one: "lingwa", two: "lingwi", few: "lingwi", other: "lingwa" }, project: { one: "proġett", two: "proġetti", few: "proġetti", other: "proġett" } },
  pl: { language: { one: "język", few: "języki", many: "języków", other: "języków" }, project: { one: "projekt", few: "projekty", many: "projektów", other: "projektów" } },
  pt: { language: { one: "idioma", other: "idiomas" }, project: { one: "projeto", other: "projetos" } },
  ro: { language: { one: "limbă", few: "limbi", other: "de limbi" }, project: { one: "proiect", few: "proiecte", other: "de proiecte" } },
  sk: { language: { one: "jazyk", few: "jazyky", other: "jazykov" }, project: { one: "projekt", few: "projekty", other: "projektov" } },
  sl: { language: { one: "jezik", two: "jezika", few: "jeziki", other: "jezikov" }, project: { one: "projekt", two: "projekta", few: "projekti", other: "projektov" } },
  es: { language: { one: "idioma", other: "idiomas" }, project: { one: "proyecto", other: "proyectos" } },
  sv: { language: { one: "språk", other: "språk" }, project: { one: "projekt", other: "projekt" } },
};

function formatWordCount(value: number, locale: SiteLocale): string {
  if (value >= 1_000_000) {
    return formatCompactWordCount(value, locale);
  }

  return value.toLocaleString(getIntlLocale(locale));
}

function centsToWholeEuros(cents: number | null | undefined): number | null {
  if (typeof cents !== "number") return null;
  return Math.round(cents / 100);
}

function formatPriceSuffix(
  locale: SiteLocale,
  yearly: boolean,
  yearlyLabel: string
): string {
  const monthLabel = getDateTimeFieldLabel(locale, "month");

  if (!yearly) {
    return `/${monthLabel}`;
  }

  return `/${monthLabel}, ${yearlyLabel.toLocaleLowerCase(getIntlLocale(locale))}`;
}

type PricingGridProps = {
  locale: SiteLocale;
  /** Auth/plan state of the page viewer; omitted on statically rendered pages. */
  viewer?: ViewerBillingContext;
};

export function PricingGrid({ locale, viewer }: PricingGridProps) {
  // The slider lets visitors land on a tier interactively. The default index
  // points at PRO so the marketing-recommended plan is what greets every
  // visitor before they touch the slider.
  const defaultIndex = Math.max(BILLING_PLAN_KEYS.indexOf("PRO"), 0);
  const [tierIndex, setTierIndex] = useState(defaultIndex);
  const [yearly, setYearly] = useState(false);
  const [ctaLoading, setCtaLoading] = useState(false);

  const copy = localizeCopy(locale, PRICING_COPY);
  const signupHref = getMarketingPath(locale, "signup");
  const loggedIn = viewer?.loggedIn ?? false;
  const viewerPlan = viewer?.plan ?? null;
  const interval = yearly ? "yearly" : "monthly";
  const enterpriseMailto = "mailto:office@ostheimer.at?subject=Deepglot%20Enterprise";

  const tierKey = BILLING_PLAN_KEYS[tierIndex];
  const tier = BILLING_PLANS[tierKey];
  const features = localizeCopy(locale, PLAN_FEATURES[tierKey]);
  const isFree = tierKey === "FREE";
  const isEnterprise = tierKey === "ENTERPRISE";

  const monthlyEuros = centsToWholeEuros(tier.monthlyPriceCents);
  const yearlyMonthlyEuros = centsToWholeEuros(
    formatYearlyMonthlyEquivalentCents(tierKey)
  );
  const yearlyTotalEuros = centsToWholeEuros(computeYearlyTotalCents(tierKey));

  const displayedEuros = yearly ? yearlyMonthlyEuros : monthlyEuros;
  const priceSuffix = formatPriceSuffix(locale, yearly, copy.yearly);
  const yearlyTotalSuffix = `/${getDateTimeFieldLabel(locale, "year")}`;
  // Inflect the language/project nouns for the exact slider count using the
  // locale's CLDR plural rules, so "1 Sprache" / "2 Sprachen" / "5 jazyku" all
  // read correctly. Forms live in PLAN_SPEC_NOUNS; "other" is the fallback.
  const pluralRules = new Intl.PluralRules(getIntlLocale(locale));
  const nouns = PLAN_SPEC_NOUNS[locale];
  const pickNoun = (forms: PluralForms, count: number) =>
    forms[pluralRules.select(count)] ?? forms.other;
  const languagesLabel = pickNoun(nouns.language, tier.languagesLimit);
  const projectsLabel = pickNoun(nouns.project, tier.projectsLimit);

  const ctaClass = `block w-full rounded-xl py-3 text-center text-sm font-semibold text-white transition-colors ${
    tier.highlight
      ? "bg-indigo-600 hover:bg-indigo-700"
      : "bg-gray-900 hover:bg-black"
  }`;

  async function handleCheckout() {
    setCtaLoading(true);
    try {
      await startCheckout(tierKey, interval);
    } catch {
      toast.error(copy.checkoutError);
      setCtaLoading(false);
    }
  }

  async function handlePortal() {
    setCtaLoading(true);
    try {
      await openBillingPortal();
    } catch {
      toast.error(copy.checkoutError);
      setCtaLoading(false);
    }
  }

  function renderCta() {
    if (isEnterprise) {
      return (
        <a
          href={enterpriseMailto}
          className="block w-full rounded-xl bg-gray-900 py-3 text-center text-sm font-semibold text-white transition-colors hover:bg-black"
        >
          {copy.enterpriseCta}
        </a>
      );
    }

    if (!loggedIn) {
      const href = isFree
        ? signupHref
        : `${signupHref}?plan=${tierKey}&interval=${interval}`;
      return (
        <Link href={href} className={ctaClass}>
          {isFree ? copy.primaryCta : copy.paidCta}
        </Link>
      );
    }

    if (viewerPlan === tierKey) {
      return (
        <button
          type="button"
          disabled
          className="block w-full cursor-default rounded-xl border border-gray-200 bg-gray-50 py-3 text-center text-sm font-semibold text-gray-500"
        >
          {copy.currentPlan}
        </button>
      );
    }

    // Free tier card for a logged-in user already on a paid plan: route them
    // to the portal to downgrade rather than offering a meaningless sign-up.
    if (isFree) {
      return (
        <button
          type="button"
          onClick={handlePortal}
          disabled={ctaLoading}
          className={`${ctaClass} disabled:opacity-60`}
        >
          {ctaLoading ? copy.redirecting : copy.managePlan}
        </button>
      );
    }

    // Paid tier. FREE (or org-less) viewers go straight to Checkout; viewers
    // already on another paid plan switch tiers through the billing portal.
    const onFreeOrNoPlan = viewerPlan === "FREE" || viewerPlan === null;
    return (
      <button
        type="button"
        onClick={onFreeOrNoPlan ? handleCheckout : handlePortal}
        disabled={ctaLoading}
        className={`${ctaClass} disabled:opacity-60`}
      >
        {ctaLoading
          ? copy.redirecting
          : onFreeOrNoPlan
            ? copy.paidCta
            : copy.managePlan}
      </button>
    );
  }

  return (
    <div className="mx-auto max-w-3xl px-4 sm:px-6 lg:px-8 pb-20">
      {/* Monthly / Yearly toggle ------------------------------------------ */}
      <div className="mb-10 flex flex-col items-center gap-2">
        <div className="inline-flex items-center gap-4">
          <span
            className={`text-sm font-medium select-none ${
              !yearly ? "text-gray-900" : "text-gray-400"
            }`}
          >
            {copy.monthly}
          </span>
          <button
            type="button"
            role="switch"
            aria-checked={yearly}
            aria-label={copy.billingToggleLabel}
            onClick={() => setYearly((value) => !value)}
            className={`relative inline-flex h-6 w-12 shrink-0 items-center rounded-full transition-colors duration-200 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-2 ${
              yearly ? "bg-indigo-600" : "bg-gray-300"
            }`}
          >
            <span
              aria-hidden="true"
              className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow ring-0 transition-transform duration-200 ${
                yearly ? "translate-x-6" : "translate-x-0.5"
              }`}
            />
          </button>
          <span
            className={`text-sm font-medium select-none ${
              yearly ? "text-gray-900" : "text-gray-400"
            }`}
          >
            {copy.yearly}
          </span>
        </div>
        <span className="text-xs font-semibold text-green-600">
          {copy.yearlySavings}
        </span>
      </div>

      {/* Usage slider ----------------------------------------------------- */}
      <div className="mb-8">
        <div className="mb-3 flex items-baseline justify-between">
          <label
            htmlFor="deepglot-words-slider"
            className="text-xs font-medium uppercase tracking-wide text-gray-500"
          >
            {copy.sliderLabel}
          </label>
          <span className="text-2xl font-extrabold text-indigo-600 tabular-nums">
            {formatWordCount(tier.wordsLimit, locale)}
          </span>
        </div>
        <input
          id="deepglot-words-slider"
          type="range"
          min={0}
          max={BILLING_PLAN_KEYS.length - 1}
          step={1}
          value={tierIndex}
          onChange={(event) => setTierIndex(Number(event.target.value))}
          aria-valuetext={`${tier.name}: ${formatWordCount(tier.wordsLimit, locale)} ${copy.wordsLabel}`}
          className="w-full cursor-pointer appearance-none bg-transparent focus:outline-none [&::-webkit-slider-runnable-track]:h-2 [&::-webkit-slider-runnable-track]:rounded-full [&::-webkit-slider-runnable-track]:bg-gradient-to-r [&::-webkit-slider-runnable-track]:from-indigo-100 [&::-webkit-slider-runnable-track]:via-indigo-300 [&::-webkit-slider-runnable-track]:to-indigo-600 [&::-webkit-slider-thumb]:mt-[-8px] [&::-webkit-slider-thumb]:h-6 [&::-webkit-slider-thumb]:w-6 [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:border-2 [&::-webkit-slider-thumb]:border-white [&::-webkit-slider-thumb]:bg-indigo-600 [&::-webkit-slider-thumb]:shadow-lg [&::-moz-range-track]:h-2 [&::-moz-range-track]:rounded-full [&::-moz-range-track]:bg-indigo-200 [&::-moz-range-thumb]:h-6 [&::-moz-range-thumb]:w-6 [&::-moz-range-thumb]:rounded-full [&::-moz-range-thumb]:border-2 [&::-moz-range-thumb]:border-white [&::-moz-range-thumb]:bg-indigo-600"
        />
        {/*
          Tick labels are absolutely positioned to match the native range
          input's thumb travel exactly. The thumb (24px / w-6) centres at
          `thumbRadius` on the left and `100% - thumbRadius` on the right,
          so labels at `calc(12px + (100% - 24px) * idx / (n-1))` sit on
          the same x as the thumb for every tier. Plain `justify-between`
          flex layout would drift because each button's *left edge* — not
          its centre — is what gets distributed, so wider labels at the
          ends visibly offset from the thumb.
        */}
        <div className="relative mt-2 h-4 text-[10px] font-medium uppercase tracking-wide text-gray-400">
          {BILLING_PLAN_KEYS.map((key, idx) => {
            const lastIndex = BILLING_PLAN_KEYS.length - 1;
            return (
              <button
                key={key}
                type="button"
                onClick={() => setTierIndex(idx)}
                style={{
                  left: `calc(12px + (100% - 24px) * ${idx} / ${lastIndex})`,
                }}
                className={`absolute top-0 -translate-x-1/2 whitespace-nowrap transition-colors hover:text-indigo-600 ${
                  idx === tierIndex ? "text-indigo-600" : ""
                }`}
                aria-label={`${BILLING_PLANS[key].name}: ${formatWordCount(BILLING_PLANS[key].wordsLimit, locale)}`}
              >
                {formatWordCount(BILLING_PLANS[key].wordsLimit, locale)}
              </button>
            );
          })}
        </div>
        <p className="mt-3 text-center text-xs text-gray-500">{copy.sliderHint}</p>
      </div>

      {/* Selected plan card ---------------------------------------------- */}
      <div
        className={`rounded-3xl border-2 p-6 sm:p-8 transition-colors ${
          tier.highlight
            ? "border-indigo-600 bg-gradient-to-b from-white to-indigo-50/30"
            : "border-gray-200 bg-white"
        }`}
      >
        <div className="flex flex-col gap-6 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <p className="text-2xl font-bold text-gray-900">{tier.name}</p>
              {tier.highlight && (
                <span className="inline-flex items-center rounded-full bg-indigo-600 px-2.5 py-0.5 text-xs font-semibold text-white">
                  {copy.recommendedBadge}
                </span>
              )}
            </div>
            <p className="mt-1 text-sm text-gray-600">
              {formatWordCount(tier.wordsLimit, locale)} {copy.wordsLabel} · {tier.languagesLimit} {languagesLabel} · {tier.projectsLimit} {projectsLabel}
            </p>
          </div>

          <div className="text-left sm:text-right">
            {isEnterprise ? (
              <p className="text-3xl font-extrabold text-gray-900">
                {copy.enterprisePrice}
              </p>
            ) : displayedEuros === 0 ? (
              <p className="text-4xl font-extrabold text-gray-900">€0</p>
            ) : (
              <>
                <p className="text-4xl font-extrabold text-gray-900">
                  €{displayedEuros}
                  <span className="text-sm font-normal text-gray-500">
                    {priceSuffix}
                  </span>
                </p>
                {yearly && yearlyTotalEuros !== null && yearlyTotalEuros > 0 && (
                  <p className="mt-1 text-xs text-gray-500">
                    €{yearlyTotalEuros}
                    {yearlyTotalSuffix} · {copy.yearlySavingsHint}
                  </p>
                )}
              </>
            )}
          </div>
        </div>

        <ul className="mt-6 grid gap-3 sm:grid-cols-2">
          {features.map((feature) => (
            <li key={feature} className="flex items-start gap-2 text-sm text-gray-700">
              <Check className="mt-0.5 h-4 w-4 flex-shrink-0 text-indigo-600" />
              <span>{feature}</span>
            </li>
          ))}
        </ul>

        <div className="mt-8">{renderCta()}</div>
      </div>

      {/* Enterprise hint -------------------------------------------------- */}
      {!isEnterprise && (
        <p className="mt-6 text-center text-xs text-gray-500">
          {copy.contactPrompt}{" "}
          <a className="text-indigo-600 hover:underline" href={enterpriseMailto}>
            {copy.enterpriseCta}
          </a>
          .
        </p>
      )}

      {/* FAQ footer ------------------------------------------------------- */}
      <div className="mt-12 text-center">
        <p className="text-sm text-gray-500">
          {copy.faq}{" "}
          <a
            href="mailto:office@ostheimer.at?subject=Deepglot%20Plans"
            className="text-indigo-600 hover:underline"
          >
            {copy.faqCta}
          </a>{" "}
          - {copy.faqSuffix}
        </p>
      </div>
    </div>
  );
}
