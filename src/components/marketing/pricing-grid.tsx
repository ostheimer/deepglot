"use client";

import { useState } from "react";
import Link from "next/link";
import { Check } from "lucide-react";

import { getMarketingPath, type SiteLocale } from "@/lib/site-locale";
import {
  BILLING_PLANS,
  BILLING_PLAN_KEYS,
  computeYearlyTotalCents,
  formatYearlyMonthlyEquivalentCents,
  type BillingPlanKey,
} from "@/lib/billing-plans";

type PaidPlanKey = Exclude<BillingPlanKey, "ENTERPRISE">;

/**
 * Plans the marketing pricing grid advertises. Only `visibleInMarketing`
 * paid tiers are listed; Enterprise is rendered separately as the dark
 * sidebar card. Hidden tiers (Business / Advanced / Extended) stay in the
 * billing-plans catalogue so existing subscriptions keep their tier metadata
 * but the public grid stays focused on four columns.
 */
const PAID_PLAN_KEYS = BILLING_PLAN_KEYS.filter(
  (key): key is PaidPlanKey =>
    key !== "ENTERPRISE" && BILLING_PLANS[key].visibleInMarketing
);

type FeatureRow = {
  label: string;
  /** Indexed by PAID_PLAN_KEYS order: FREE, STARTER, BUSINESS, PRO, ADVANCED, EXTENDED. */
  values: (boolean | string)[];
  /** Concrete value for Enterprise — never the string "unlimited". */
  enterprise: boolean | string;
};

type PlanCopy = {
  cta: string;
  badge: string | null;
  featureSummary: string;
};

const PLAN_COPY: Record<SiteLocale, Record<PaidPlanKey, PlanCopy>> = {
  en: {
    FREE: {
      cta: "Start free",
      badge: null,
      featureSummary: "AI translation, glossary, and more",
    },
    STARTER: {
      cta: "Try for free",
      badge: null,
      featureSummary: "Media translation, auto-redirect, and more",
    },
    BUSINESS: {
      cta: "Try for free",
      badge: null,
      featureSummary: "Access to pro translators, and more",
    },
    PRO: {
      cta: "Try for free",
      badge: "Recommended",
      featureSummary: "Analytics, URL tracking, and more",
    },
    ADVANCED: {
      cta: "Try for free",
      badge: null,
      featureSummary: "Import & export, custom languages, and more",
    },
    EXTENDED: {
      cta: "Try for free",
      badge: null,
      featureSummary: "Top-level domain support, premium support, and more",
    },
  },
  de: {
    FREE: {
      cta: "Kostenlos starten",
      badge: null,
      featureSummary: "KI-Übersetzung, Glossar, und mehr",
    },
    STARTER: {
      cta: "Kostenlos testen",
      badge: null,
      featureSummary: "Medien-Übersetzung, Auto-Weiterleitung, und mehr",
    },
    BUSINESS: {
      cta: "Kostenlos testen",
      badge: null,
      featureSummary: "Zugang zu Pro-Übersetzern, und mehr",
    },
    PRO: {
      cta: "Kostenlos testen",
      badge: "Empfohlen",
      featureSummary: "Statistiken, URL-Tracking, und mehr",
    },
    ADVANCED: {
      cta: "Kostenlos testen",
      badge: null,
      featureSummary: "Export & Import, Custom Sprachen, und mehr",
    },
    EXTENDED: {
      cta: "Kostenlos testen",
      badge: null,
      featureSummary: "Top-Level-Domain, Premium Support, und mehr",
    },
  },
};

function formatNumber(value: number, locale: SiteLocale): string {
  if (value >= 1_000_000) {
    const millions = value / 1_000_000;
    if (locale === "de") {
      return `${millions.toLocaleString("de-AT", { maximumFractionDigits: 1 })} Mio.`;
    }
    return `${millions.toLocaleString("en-US", { maximumFractionDigits: 1 })}M`;
  }
  return value.toLocaleString(locale === "de" ? "de-AT" : "en-US");
}

const FEATURE_LABELS: Record<SiteLocale, Record<string, string>> = {
  en: {
    words: "Words / month",
    languages: "Translation languages",
    projects: "Projects",
    providerFlex: "Provider-flexible AI translation",
    glossary: "Glossary",
    media: "Media translation",
    autoRedirect: "Auto-redirect",
    analytics: "Analytics",
    urlSlugs: "Translated URL slugs",
    visualEditor: "Visual editor",
    importExport: "Import & export (CSV/PO)",
    customProvider: "Custom AI provider",
    tldSupport: "Top-level domain support",
    premiumSupport: "Premium support (SLA)",
    saml: "SAML SSO",
    contract: "Dedicated contract (DPA)",
  },
  de: {
    words: "Wörter / Monat",
    languages: "Übersetzungssprachen",
    projects: "Projekte",
    providerFlex: "Provider-flexible KI-Übersetzung",
    glossary: "Glossar",
    media: "Medien-Übersetzung",
    autoRedirect: "Auto-Weiterleitung",
    analytics: "Statistiken",
    urlSlugs: "URL-Slugs übersetzen",
    visualEditor: "Visueller Editor",
    importExport: "Export & Import (CSV/PO)",
    customProvider: "Eigener KI-Provider",
    tldSupport: "Top-Level-Domain Support",
    premiumSupport: "Premium Support (SLA)",
    saml: "SAML SSO",
    contract: "Dedizierter Vertrag (DPA)",
  },
};

function buildFeatureRows(locale: SiteLocale): FeatureRow[] {
  const labels = FEATURE_LABELS[locale];
  const enterprisePlan = BILLING_PLANS.ENTERPRISE;
  const paidLimits = PAID_PLAN_KEYS.map((key) => BILLING_PLANS[key]);

  return [
    {
      label: labels.words,
      values: paidLimits.map((plan) => formatNumber(plan.wordsLimit, locale)),
      enterprise: formatNumber(enterprisePlan.wordsLimit, locale),
    },
    {
      label: labels.languages,
      values: paidLimits.map((plan) => String(plan.languagesLimit)),
      enterprise: String(enterprisePlan.languagesLimit),
    },
    {
      label: labels.projects,
      values: paidLimits.map((plan) => String(plan.projectsLimit)),
      enterprise: String(enterprisePlan.projectsLimit),
    },
    // Feature columns map to PAID_PLAN_KEYS in order: [FREE, STARTER, PRO].
    // Enterprise has its own column to the right.
    { label: labels.providerFlex, values: [true, true, true], enterprise: true },
    { label: labels.glossary, values: [true, true, true], enterprise: true },
    { label: labels.media, values: [false, true, true], enterprise: true },
    { label: labels.autoRedirect, values: [false, true, true], enterprise: true },
    { label: labels.analytics, values: [false, true, true], enterprise: true },
    { label: labels.urlSlugs, values: [false, false, true], enterprise: true },
    { label: labels.visualEditor, values: [false, false, true], enterprise: true },
    { label: labels.importExport, values: [false, false, true], enterprise: true },
    { label: labels.customProvider, values: [false, false, true], enterprise: true },
    { label: labels.tldSupport, values: [false, false, false], enterprise: true },
    { label: labels.premiumSupport, values: [false, false, true], enterprise: true },
    { label: labels.saml, values: [false, false, false], enterprise: true },
    { label: labels.contract, values: [false, false, false], enterprise: true },
  ];
}

const PRICING_COPY = {
  en: {
    monthly: "Monthly",
    yearly: "Yearly",
    yearlySavings: "2 months free",
    priceSuffix: "/mo.",
    yearlySuffix: "/year",
    yearlyBilled: "billed yearly",
    wordsLabel: "words",
    languageSingular: "translation language",
    languagePlural: "translation languages",
    enterprisePrice: "Custom pricing",
    enterpriseContact: "Contact sales",
    enterpriseHeading: "Enterprise-grade security & compliance",
    enterpriseDescription: "Security review and SAML-based SSO",
    enterpriseContract: "Dedicated contract",
    enterpriseContractDetail: "with a custom DPA and SLA",
    enterpriseTransfer: "Bank transfer available",
    featureTableTitle: "What is included in every plan?",
    faq: "Questions about the plans?",
    faqCta: "Talk to us",
    faqSuffix: "and we will help you choose the right setup.",
    billingToggleLabel: "Toggle yearly billing",
  },
  de: {
    monthly: "Monatlich",
    yearly: "Jährlich",
    yearlySavings: "2 Monate gratis",
    priceSuffix: "/Mo.",
    yearlySuffix: "/Jahr",
    yearlyBilled: "jährlich abgerechnet",
    wordsLabel: "Wörter",
    languageSingular: "Übersetzungssprache",
    languagePlural: "Übersetzungssprachen",
    enterprisePrice: "Preis auf Anfrage",
    enterpriseContact: "Kontakt",
    enterpriseHeading: "Enterprise-Grade Sicherheit & Compliance",
    enterpriseDescription: "Sicherheitsprüfung und SAML-basiertes SSO",
    enterpriseContract: "Dedizierter Vertrag",
    enterpriseContractDetail: "mit individuellem DPA und SLA",
    enterpriseTransfer: "Überweisung möglich",
    featureTableTitle: "Was ist in jedem Plan enthalten?",
    faq: "Fragen zu den Plänen?",
    faqCta: "Schreib uns",
    faqSuffix: "wir helfen gerne.",
    billingToggleLabel: "Jährliche Abrechnung umschalten",
  },
} as const;

type PricingGridProps = {
  locale: SiteLocale;
};

function centsToWholeEuros(cents: number | null | undefined): number {
  if (typeof cents !== "number") return 0;
  return Math.round(cents / 100);
}

export function PricingGrid({ locale }: PricingGridProps) {
  const [yearly, setYearly] = useState(false);
  const copy = PRICING_COPY[locale];
  const planCopy = PLAN_COPY[locale];
  const rows = buildFeatureRows(locale);
  const signupHref = getMarketingPath(locale, "signup");

  const paidPlans = PAID_PLAN_KEYS.map((key) => {
    const plan = BILLING_PLANS[key];
    const monthlyEuros = centsToWholeEuros(plan.monthlyPriceCents);
    const yearlyMonthlyEquivalentEuros = centsToWholeEuros(
      formatYearlyMonthlyEquivalentCents(key)
    );
    const yearlyTotalEuros = centsToWholeEuros(computeYearlyTotalCents(key));

    return {
      key,
      plan,
      copy: planCopy[key],
      monthlyEuros,
      yearlyMonthlyEquivalentEuros,
      yearlyTotalEuros,
    };
  });

  const enterprisePlan = BILLING_PLANS.ENTERPRISE;

  return (
    <div className="max-w-[1300px] mx-auto px-4 sm:px-6 lg:px-8 pb-16">
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

      <div className="flex flex-col gap-4 sm:gap-3 lg:flex-row lg:items-stretch">
        <div className={`grid gap-4 sm:gap-3 grid-cols-1 sm:grid-cols-2 ${paidPlans.length === 3 ? "lg:grid-cols-3" : "lg:grid-cols-4"} flex-1`}>
          {paidPlans.map(({ key, plan, copy: planRowCopy, monthlyEuros, yearlyMonthlyEquivalentEuros, yearlyTotalEuros }) => {
            const displayedEuros = yearly ? yearlyMonthlyEquivalentEuros : monthlyEuros;
            const isHighlighted = plan.highlight;

            return (
              <div
                key={key}
                className={`relative flex flex-col rounded-2xl border-2 overflow-hidden transition-shadow ${
                  isHighlighted
                    ? "border-indigo-600 shadow-xl shadow-indigo-100"
                    : "border-gray-200 hover:border-gray-300 hover:shadow-md"
                }`}
              >
                {planRowCopy.badge && (
                  <div className="absolute top-0 inset-x-0 h-1 bg-indigo-600" />
                )}

                <div className="flex h-full flex-col bg-white p-4">
                  <p className="text-sm font-bold text-gray-900 mb-2">{plan.name}</p>

                  <div className="mb-3">
                    {displayedEuros === 0 ? (
                      <p className="text-2xl font-extrabold text-gray-900">€0</p>
                    ) : (
                      <p className="text-2xl font-extrabold text-gray-900">
                        €{displayedEuros}
                        <span className="text-sm font-normal text-gray-500">{copy.priceSuffix}</span>
                      </p>
                    )}
                    {yearly && yearlyTotalEuros > 0 && (
                      <p className="text-xs text-gray-400 mt-0.5">
                        €{yearlyTotalEuros} {copy.yearlySuffix} · {copy.yearlyBilled}
                      </p>
                    )}
                  </div>

                  <Link
                    href={signupHref}
                    className={`mb-4 flex w-full justify-center rounded-lg py-2 text-sm font-semibold text-white transition-colors ${
                      isHighlighted
                        ? "bg-gray-900 hover:bg-black"
                        : "bg-indigo-600 hover:bg-indigo-700"
                    }`}
                  >
                    {planRowCopy.cta}
                  </Link>

                  <div className="border-t border-gray-100 mb-3" />

                  <div className="mb-1">
                    <p className="text-lg font-bold text-gray-900">{formatNumber(plan.wordsLimit, locale)}</p>
                    <p className="text-xs text-gray-500">{copy.wordsLabel}</p>
                  </div>

                  <div className="mb-3">
                    <p className="text-sm font-medium text-gray-700">
                      {plan.languagesLimit}{" "}
                      {plan.languagesLimit === 1 ? copy.languageSingular : copy.languagePlural}
                    </p>
                  </div>

                  <p className="text-xs text-gray-500 leading-relaxed mt-auto">
                    {planRowCopy.featureSummary}
                  </p>
                </div>
              </div>
            );
          })}
        </div>

        <div className="lg:w-56 lg:flex-shrink-0">
          <div className="h-full rounded-2xl bg-[#1a1a2e] text-white p-5 flex flex-col">
            <p className="text-sm font-bold mb-3">{enterprisePlan.name}</p>

            <p className="text-xs text-gray-300 mb-3">{copy.enterprisePrice}</p>

            <a
              href="mailto:office@ostheimer.at?subject=Deepglot%20Enterprise"
              className="mb-4 flex w-full justify-center rounded-lg bg-indigo-600 py-2 text-sm font-semibold text-white transition-colors hover:bg-indigo-500"
            >
              {copy.enterpriseContact}
            </a>

            <div className="border-t border-white/10 mb-4" />

            <div className="space-y-3 flex-1">
              <div>
                <p className="text-xs font-semibold text-white leading-tight">
                  {copy.enterpriseHeading}
                </p>
                <p className="text-xs text-gray-400 mt-0.5 leading-snug">
                  {copy.enterpriseDescription}
                </p>
              </div>

              <div className="border-t border-white/10" />

              <p className="text-xs text-white font-medium leading-snug">
                {copy.enterpriseContract}{" "}
                <span className="text-gray-400 font-normal">
                  {copy.enterpriseContractDetail}
                </span>
              </p>

              <div className="border-t border-white/10" />

              <p className="text-xs text-white">Custom Reverse Proxy</p>

              <div className="border-t border-white/10" />

              <p className="text-xs text-white">
                {copy.enterpriseTransfer}
              </p>
            </div>
          </div>
        </div>
      </div>

      <div className="mt-16">
        <h2 className="text-2xl font-bold text-gray-900 text-center mb-8">
          {copy.featureTableTitle}
        </h2>
        <div className="bg-white border border-gray-200 rounded-2xl overflow-hidden">
          <div className="grid grid-cols-[220px_repeat(3,1fr)_120px] bg-gray-50 border-b border-gray-200">
            <div className="p-4" />
            {paidPlans.map(({ key, plan, monthlyEuros, yearlyMonthlyEquivalentEuros }) => (
              <div
                key={key}
                className={`p-4 text-center border-l border-gray-200 ${
                  plan.highlight ? "bg-indigo-50" : ""
                }`}
              >
                <p className="text-xs font-bold text-gray-900">{plan.name}</p>
                <p className="text-xs text-gray-500 mt-0.5">
                  €{yearly ? yearlyMonthlyEquivalentEuros : monthlyEuros}{copy.priceSuffix}
                </p>
              </div>
            ))}
            <div className="p-4 text-center border-l border-gray-200 bg-[#1a1a2e]">
              <p className="text-xs font-bold text-white">{enterprisePlan.name}</p>
              <p className="text-xs text-gray-400 mt-0.5">{copy.enterprisePrice}</p>
            </div>
          </div>

          {rows.map((row, i) => (
            <div
              key={row.label}
              className={`grid grid-cols-[220px_repeat(3,1fr)_120px] border-b border-gray-100 last:border-0 ${
                i % 2 === 1 ? "bg-gray-50/50" : ""
              }`}
            >
              <div className="p-3.5 flex items-center">
                <p className="text-xs font-medium text-gray-700">{row.label}</p>
              </div>
              {row.values.map((val, j) => (
                <div
                  key={j}
                  className={`p-3.5 flex items-center justify-center border-l border-gray-100 ${
                    // Highlight the column for the recommended plan (PRO sits
                    // at index 2 in the paid grid: FREE / STARTER / PRO).
                    j === 2 ? "bg-indigo-50/30" : ""
                  }`}
                >
                  {val === true ? (
                    <Check className="h-4 w-4 text-indigo-600" />
                  ) : val === false ? (
                    <span className="text-gray-300 text-lg leading-none">–</span>
                  ) : (
                    <span className="text-xs font-medium text-gray-700">{val}</span>
                  )}
                </div>
              ))}
              <div className="p-3.5 flex items-center justify-center border-l border-gray-100 bg-[#1a1a2e]/5">
                {row.enterprise === true ? (
                  <Check className="h-4 w-4 text-indigo-600" />
                ) : (
                  <span className="text-xs font-medium text-gray-700">{row.enterprise}</span>
                )}
              </div>
            </div>
          ))}
        </div>
      </div>

      <div className="mt-16 text-center">
        <p className="text-gray-500 text-sm">
          {copy.faq}{" "}
          <a href="mailto:office@ostheimer.at?subject=Deepglot%20Plans" className="text-indigo-600 hover:underline">
            {copy.faqCta}
          </a>{" "}
          - {copy.faqSuffix}
        </p>
      </div>
    </div>
  );
}
