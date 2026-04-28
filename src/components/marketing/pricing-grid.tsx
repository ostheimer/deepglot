"use client";

import { useState } from "react";
import Link from "next/link";
import { Check } from "lucide-react";

import { getMarketingPath, type SiteLocale } from "@/lib/site-locale";

type PricingPlan = {
  key: string;
  name: string;
  monthlyPrice: number;
  yearlyPrice: number;
  words: string;
  languages: number;
  highlight: boolean;
  cta: string;
  badge: string | null;
  featureSummary: string;
};

type FeatureRow = {
  label: string;
  values: (boolean | string)[];
  enterprise: boolean | string;
};

const PLAN_DATA: Record<SiteLocale, PricingPlan[]> = {
  en: [
    {
      key: "free",
      name: "Free",
      monthlyPrice: 0,
      yearlyPrice: 0,
      words: "2,000",
      languages: 1,
      highlight: false,
      cta: "Start free",
      badge: null,
      featureSummary: "AI translation, glossary, and more",
    },
    {
      key: "starter",
      name: "Starter",
      monthlyPrice: 9,
      yearlyPrice: 7,
      words: "10,000",
      languages: 1,
      highlight: false,
      cta: "Try for free",
      badge: null,
      featureSummary: "Media translation, auto-redirect, and more",
    },
    {
      key: "business",
      name: "Business",
      monthlyPrice: 19,
      yearlyPrice: 15,
      words: "50,000",
      languages: 3,
      highlight: false,
      cta: "Try for free",
      badge: null,
      featureSummary: "Access to pro translators, and more",
    },
    {
      key: "pro",
      name: "Pro",
      monthlyPrice: 49,
      yearlyPrice: 39,
      words: "200,000",
      languages: 5,
      highlight: true,
      cta: "Try for free",
      badge: "Recommended",
      featureSummary: "Analytics, URL tracking, and more",
    },
    {
      key: "advanced",
      name: "Advanced",
      monthlyPrice: 99,
      yearlyPrice: 79,
      words: "1,000,000",
      languages: 10,
      highlight: false,
      cta: "Try for free",
      badge: null,
      featureSummary: "Import & export, custom languages, and more",
    },
    {
      key: "extended",
      name: "Extended",
      monthlyPrice: 249,
      yearlyPrice: 199,
      words: "5,000,000",
      languages: 20,
      highlight: false,
      cta: "Try for free",
      badge: null,
      featureSummary: "Top-level domain support, premium support, and more",
    },
  ],
  de: [
    {
      key: "free",
      name: "Free",
      monthlyPrice: 0,
      yearlyPrice: 0,
      words: "2.000",
      languages: 1,
      highlight: false,
      cta: "Kostenlos starten",
      badge: null,
      featureSummary: "KI-Übersetzung, Glossar, und mehr",
    },
    {
      key: "starter",
      name: "Starter",
      monthlyPrice: 9,
      yearlyPrice: 7,
      words: "10.000",
      languages: 1,
      highlight: false,
      cta: "Kostenlos testen",
      badge: null,
      featureSummary: "Medien-Übersetzung, Auto-Weiterleitung, und mehr",
    },
    {
      key: "business",
      name: "Business",
      monthlyPrice: 19,
      yearlyPrice: 15,
      words: "50.000",
      languages: 3,
      highlight: false,
      cta: "Kostenlos testen",
      badge: null,
      featureSummary: "Zugang zu Pro-Übersetzern, und mehr",
    },
    {
      key: "pro",
      name: "Pro",
      monthlyPrice: 49,
      yearlyPrice: 39,
      words: "200.000",
      languages: 5,
      highlight: true,
      cta: "Kostenlos testen",
      badge: "Empfohlen",
      featureSummary: "Statistiken, URL-Tracking, und mehr",
    },
    {
      key: "advanced",
      name: "Advanced",
      monthlyPrice: 99,
      yearlyPrice: 79,
      words: "1.000.000",
      languages: 10,
      highlight: false,
      cta: "Kostenlos testen",
      badge: null,
      featureSummary: "Export & Import, Custom Sprachen, und mehr",
    },
    {
      key: "extended",
      name: "Extended",
      monthlyPrice: 249,
      yearlyPrice: 199,
      words: "5.000.000",
      languages: 20,
      highlight: false,
      cta: "Kostenlos testen",
      badge: null,
      featureSummary: "Top-Level-Domain, Premium Support, und mehr",
    },
  ],
};

const FEATURE_ROWS: Record<SiteLocale, FeatureRow[]> = {
  en: [
    { label: "Words / month", values: ["2,000", "10,000", "50,000", "200,000", "1M", "5M"], enterprise: "Custom" },
    { label: "Translation languages", values: ["1", "1", "3", "5", "10", "20"], enterprise: "Unlimited" },
    { label: "Projects", values: ["1", "2", "3", "5", "10", "25"], enterprise: "Unlimited" },
    { label: "Provider-flexible AI translation", values: [true, true, true, true, true, true], enterprise: true },
    { label: "Glossary", values: [true, true, true, true, true, true], enterprise: true },
    { label: "Media translation", values: [false, true, true, true, true, true], enterprise: true },
    { label: "Auto-redirect", values: [false, true, true, true, true, true], enterprise: true },
    { label: "Analytics", values: [false, false, true, true, true, true], enterprise: true },
    { label: "Translated URL slugs", values: [false, false, false, true, true, true], enterprise: true },
    { label: "Visual editor", values: [false, false, false, true, true, true], enterprise: true },
    { label: "Import & export (CSV/PO)", values: [false, false, false, false, true, true], enterprise: true },
    { label: "Custom AI provider", values: [false, false, false, false, true, true], enterprise: true },
    { label: "Top-level domain support", values: [false, false, false, false, false, true], enterprise: true },
    { label: "Premium support (SLA)", values: [false, false, false, false, false, true], enterprise: true },
    { label: "SAML SSO", values: [false, false, false, false, false, false], enterprise: true },
    { label: "Dedicated contract (DPA)", values: [false, false, false, false, false, false], enterprise: true },
  ],
  de: [
    { label: "Wörter / Monat", values: ["2.000", "10.000", "50.000", "200.000", "1 Mio.", "5 Mio."], enterprise: "Individuell" },
    { label: "Übersetzungssprachen", values: ["1", "1", "3", "5", "10", "20"], enterprise: "Unbegrenzt" },
    { label: "Projekte", values: ["1", "2", "3", "5", "10", "25"], enterprise: "Unbegrenzt" },
    { label: "Provider-flexible KI-Übersetzung", values: [true, true, true, true, true, true], enterprise: true },
    { label: "Glossar", values: [true, true, true, true, true, true], enterprise: true },
    { label: "Medien-Übersetzung", values: [false, true, true, true, true, true], enterprise: true },
    { label: "Auto-Weiterleitung", values: [false, true, true, true, true, true], enterprise: true },
    { label: "Statistiken", values: [false, false, true, true, true, true], enterprise: true },
    { label: "URL-Slugs übersetzen", values: [false, false, false, true, true, true], enterprise: true },
    { label: "Visueller Editor", values: [false, false, false, true, true, true], enterprise: true },
    { label: "Export & Import (CSV/PO)", values: [false, false, false, false, true, true], enterprise: true },
    { label: "Eigener KI-Provider", values: [false, false, false, false, true, true], enterprise: true },
    { label: "Top-Level-Domain Support", values: [false, false, false, false, false, true], enterprise: true },
    { label: "Premium Support (SLA)", values: [false, false, false, false, false, true], enterprise: true },
    { label: "SAML SSO", values: [false, false, false, false, false, false], enterprise: true },
    { label: "Dedizierter Vertrag (DPA)", values: [false, false, false, false, false, false], enterprise: true },
  ],
};

const PRICING_COPY = {
  en: {
    monthly: "Monthly",
    yearly: "Yearly",
    yearlySavings: "2 months free",
    priceSuffix: "/mo.",
    yearlySuffix: "/year",
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
  },
  de: {
    monthly: "Monatlich",
    yearly: "Jährlich",
    yearlySavings: "2 Monate gratis",
    priceSuffix: "/Mo.",
    yearlySuffix: "/Jahr",
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
  },
} as const;

type PricingGridProps = {
  locale: SiteLocale;
};

export function PricingGrid({ locale }: PricingGridProps) {
  const [yearly, setYearly] = useState(false);
  const plans = PLAN_DATA[locale];
  const rows = FEATURE_ROWS[locale];
  const copy = PRICING_COPY[locale];
  const signupHref = getMarketingPath(locale, "signup");

  return (
    <div className="max-w-[1300px] mx-auto px-4 sm:px-6 lg:px-8 pb-16">
      <div className="flex items-center justify-center gap-3 mb-10">
        <span className={`text-sm font-medium ${!yearly ? "text-gray-900" : "text-gray-400"}`}>
          {copy.monthly}
        </span>
        <button
          role="switch"
          aria-checked={yearly}
          onClick={() => setYearly((v) => !v)}
          className={`relative h-6 w-11 rounded-full transition-colors duration-200 ${
            yearly ? "bg-indigo-600" : "bg-gray-300"
          }`}
        >
          <span
            className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-transform duration-200 ${
              yearly ? "translate-x-5" : "translate-x-0.5"
            }`}
          />
        </button>
        <span className={`text-sm font-medium ${yearly ? "text-gray-900" : "text-gray-400"}`}>
          {copy.yearly}{" "}
          <span className="text-green-600 font-semibold">- {copy.yearlySavings}</span>
        </span>
      </div>

      <div className="flex gap-3 items-stretch">
        <div className="grid grid-cols-6 gap-3 flex-1">
          {plans.map((plan) => {
            const price = yearly ? plan.yearlyPrice : plan.monthlyPrice;
            const isHighlighted = plan.highlight;

            return (
              <div
                key={plan.key}
                className={`relative flex flex-col rounded-2xl border-2 overflow-hidden transition-shadow ${
                  isHighlighted
                    ? "border-indigo-600 shadow-xl shadow-indigo-100"
                    : "border-gray-200 hover:border-gray-300 hover:shadow-md"
                }`}
              >
                {plan.badge && (
                  <div className="absolute top-0 inset-x-0 h-1 bg-indigo-600" />
                )}

                <div className="flex h-full flex-col bg-white p-4">
                  <p className="text-sm font-bold text-gray-900 mb-2">{plan.name}</p>

                  <div className="mb-3">
                    {price === 0 ? (
                      <p className="text-2xl font-extrabold text-gray-900">€0</p>
                    ) : (
                      <p className="text-2xl font-extrabold text-gray-900">
                        €{price}
                        <span className="text-sm font-normal text-gray-500">{copy.priceSuffix}</span>
                      </p>
                    )}
                    {yearly && price > 0 && (
                      <p className="text-xs text-gray-400 mt-0.5">
                        €{Math.round(price * 10)} {copy.yearlySuffix}
                      </p>
                    )}
                  </div>

                  <Link href={signupHref} className="block mb-4">
                    <button
                      className={`w-full py-2 rounded-lg text-sm font-semibold transition-colors ${
                        isHighlighted
                          ? "bg-gray-900 hover:bg-black text-white"
                          : "bg-indigo-600 hover:bg-indigo-700 text-white"
                      }`}
                    >
                      {plan.cta}
                    </button>
                  </Link>

                  <div className="border-t border-gray-100 mb-3" />

                  <div className="mb-1">
                    <p className="text-lg font-bold text-gray-900">{plan.words}</p>
                    <p className="text-xs text-gray-500">{copy.wordsLabel}</p>
                  </div>

                  <div className="mb-3">
                    <p className="text-sm font-medium text-gray-700">
                      {plan.languages}{" "}
                      {plan.languages === 1 ? copy.languageSingular : copy.languagePlural}
                    </p>
                  </div>

                  <p className="text-xs text-gray-500 leading-relaxed mt-auto">
                    {plan.featureSummary}
                  </p>
                </div>
              </div>
            );
          })}
        </div>

        <div className="w-48 flex-shrink-0">
          <div className="h-full rounded-2xl bg-[#1a1a2e] text-white p-5 flex flex-col">
            <p className="text-sm font-bold mb-3">Enterprise</p>

            <p className="text-xs text-gray-300 mb-3">{copy.enterprisePrice}</p>

            <a href="mailto:enterprise@deepglot.com">
              <button className="w-full py-2 rounded-lg text-sm font-semibold bg-indigo-600 hover:bg-indigo-500 text-white transition-colors mb-4">
                {copy.enterpriseContact}
              </button>
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
          <div className="grid grid-cols-[220px_repeat(6,1fr)_120px] bg-gray-50 border-b border-gray-200">
            <div className="p-4" />
            {plans.map((p) => (
              <div
                key={p.key}
                className={`p-4 text-center border-l border-gray-200 ${
                  p.highlight ? "bg-indigo-50" : ""
                }`}
              >
                <p className="text-xs font-bold text-gray-900">{p.name}</p>
                <p className="text-xs text-gray-500 mt-0.5">
                  {yearly ? `€${p.yearlyPrice}` : `€${p.monthlyPrice}`}{copy.priceSuffix}
                </p>
              </div>
            ))}
            <div className="p-4 text-center border-l border-gray-200 bg-[#1a1a2e]">
              <p className="text-xs font-bold text-white">Enterprise</p>
              <p className="text-xs text-gray-400 mt-0.5">{copy.enterprisePrice}</p>
            </div>
          </div>

          {rows.map((row, i) => (
            <div
              key={row.label}
              className={`grid grid-cols-[220px_repeat(6,1fr)_120px] border-b border-gray-100 last:border-0 ${
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
                    j === 3 ? "bg-indigo-50/30" : ""
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
          <a href="mailto:support@deepglot.com" className="text-indigo-600 hover:underline">
            {copy.faqCta}
          </a>{" "}
          - {copy.faqSuffix}
        </p>
      </div>
    </div>
  );
}
