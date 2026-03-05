"use client";

import { useState } from "react";
import Link from "next/link";
import { Check, Mail } from "lucide-react";

// Deepglot plans – competitive vs. Weglot at better price/value
const PLANS = [
  {
    key: "free",
    name: "Free",
    monthlyPrice: 0,
    yearlyPrice: 0,
    words: "2.000",
    wordsRaw: 2000,
    languages: 1,
    highlight: false,
    cta: "Kostenlos starten",
    badge: null,
    features: [
      "KI-Übersetzung (DeepL)",
      "Glossar",
      "1 Projekt",
      "Community Support",
    ],
    featureSummary: "KI-Übersetzung, Glossar, und mehr",
  },
  {
    key: "starter",
    name: "Starter",
    monthlyPrice: 9,
    yearlyPrice: 7,
    words: "10.000",
    wordsRaw: 10000,
    languages: 1,
    highlight: false,
    cta: "Kostenlos testen",
    badge: null,
    features: [
      "KI-Übersetzung (DeepL)",
      "Medien-Übersetzung",
      "Auto-Weiterleitung",
      "E-Mail Support",
    ],
    featureSummary: "Medien-Übersetzung, Auto-Weiterleitung, und mehr",
  },
  {
    key: "business",
    name: "Business",
    monthlyPrice: 19,
    yearlyPrice: 15,
    words: "50.000",
    wordsRaw: 50000,
    languages: 3,
    highlight: false,
    cta: "Kostenlos testen",
    badge: null,
    features: [
      "Alles aus Starter",
      "Zugang zu Pro-Übersetzern",
      "3 Projekte",
      "Statistiken",
    ],
    featureSummary: "Zugang zu Pro-Übersetzern, und mehr",
  },
  {
    key: "pro",
    name: "Pro",
    monthlyPrice: 49,
    yearlyPrice: 39,
    words: "200.000",
    wordsRaw: 200000,
    languages: 5,
    highlight: true,
    cta: "Kostenlos testen",
    badge: "Empfohlen",
    features: [
      "Alles aus Business",
      "Statistiken + URL-Tracking",
      "Visueller Editor",
      "5 Projekte",
      "Prioritäts-Support",
    ],
    featureSummary: "Statistiken, URL-Tracking, und mehr",
  },
  {
    key: "advanced",
    name: "Advanced",
    monthlyPrice: 99,
    yearlyPrice: 79,
    words: "1.000.000",
    wordsRaw: 1000000,
    languages: 10,
    highlight: false,
    cta: "Kostenlos testen",
    badge: null,
    features: [
      "Alles aus Pro",
      "Export & Import (CSV/PO)",
      "Custom Sprachen",
      "10 Projekte",
      "DeepL + OpenAI",
    ],
    featureSummary: "Export & Import, Custom Sprachen, und mehr",
  },
  {
    key: "extended",
    name: "Extended",
    monthlyPrice: 249,
    yearlyPrice: 199,
    words: "5.000.000",
    wordsRaw: 5000000,
    languages: 20,
    highlight: false,
    cta: "Kostenlos testen",
    badge: null,
    features: [
      "Alles aus Advanced",
      "Top-Level-Domain Support",
      "Premium Support (SLA)",
      "25 Projekte",
      "Dedicated Onboarding",
    ],
    featureSummary: "Top-Level-Domain, Premium Support, und mehr",
  },
];

export function PricingGrid() {
  const [yearly, setYearly] = useState(false);

  return (
    <div className="max-w-[1300px] mx-auto px-4 sm:px-6 lg:px-8 pb-16">
      {/* Toggle */}
      <div className="flex items-center justify-center gap-3 mb-10">
        <span className={`text-sm font-medium ${!yearly ? "text-gray-900" : "text-gray-400"}`}>
          Monatlich
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
          Jährlich{" "}
          <span className="text-green-600 font-semibold">– 2 Monate gratis!</span>
        </span>
      </div>

      {/* Grid: 6 plans + Enterprise */}
      <div className="flex gap-3 items-stretch">
        {/* Plan cards */}
        <div className="grid grid-cols-6 gap-3 flex-1">
          {PLANS.map((plan) => {
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
                {/* Badge */}
                {plan.badge && (
                  <div className="absolute top-0 inset-x-0 h-1 bg-indigo-600" />
                )}

                <div className={`p-4 flex flex-col h-full ${isHighlighted ? "bg-white" : "bg-white"}`}>
                  {/* Plan name */}
                  <p className="text-sm font-bold text-gray-900 mb-2">{plan.name}</p>

                  {/* Price */}
                  <div className="mb-3">
                    {price === 0 ? (
                      <p className="text-2xl font-extrabold text-gray-900">€0</p>
                    ) : (
                      <p className="text-2xl font-extrabold text-gray-900">
                        €{price}
                        <span className="text-sm font-normal text-gray-500">/Mo.</span>
                      </p>
                    )}
                    {yearly && price > 0 && (
                      <p className="text-xs text-gray-400 mt-0.5">
                        €{Math.round(price * 10)} / Jahr
                      </p>
                    )}
                  </div>

                  {/* CTA */}
                  <Link href="/registrieren" className="block mb-4">
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

                  {/* Divider */}
                  <div className="border-t border-gray-100 mb-3" />

                  {/* Words */}
                  <div className="mb-1">
                    <p className="text-lg font-bold text-gray-900">{plan.words}</p>
                    <p className="text-xs text-gray-500">Wörter</p>
                  </div>

                  {/* Languages */}
                  <div className="mb-3">
                    <p className="text-sm font-medium text-gray-700">
                      {plan.languages}{" "}
                      {plan.languages === 1 ? "Übersetzungssprache" : "Übersetzungssprachen"}
                    </p>
                  </div>

                  {/* Feature summary */}
                  <p className="text-xs text-gray-500 leading-relaxed mt-auto">
                    {plan.featureSummary}
                  </p>
                </div>
              </div>
            );
          })}
        </div>

        {/* Enterprise card */}
        <div className="w-48 flex-shrink-0">
          <div className="h-full rounded-2xl bg-[#1a1a2e] text-white p-5 flex flex-col">
            <p className="text-sm font-bold mb-3">Enterprise</p>

            <p className="text-xs text-gray-300 mb-3">Preis auf Anfrage</p>

            <a href="mailto:enterprise@deepglot.com">
              <button className="w-full py-2 rounded-lg text-sm font-semibold bg-indigo-600 hover:bg-indigo-500 text-white transition-colors mb-4">
                Kontakt
              </button>
            </a>

            <div className="border-t border-white/10 mb-4" />

            <div className="space-y-3 flex-1">
              <div>
                <p className="text-xs font-semibold text-white leading-tight">
                  Enterprise-Grade Sicherheit & Compliance
                </p>
                <p className="text-xs text-gray-400 mt-0.5 leading-snug">
                  Sicherheitsprüfung und SAML-basiertes SSO
                </p>
              </div>

              <div className="border-t border-white/10" />

              <p className="text-xs text-white font-medium leading-snug">
                Dedizierter Vertrag{" "}
                <span className="text-gray-400 font-normal">
                  mit individuellem DPA und SLA
                </span>
              </p>

              <div className="border-t border-white/10" />

              <p className="text-xs text-white">Custom Reverse Proxy</p>

              <div className="border-t border-white/10" />

              <p className="text-xs text-white">
                Überweisung{" "}
                <span className="text-gray-400">möglich</span>
              </p>
            </div>
          </div>
        </div>
      </div>

      {/* Feature comparison table */}
      <div className="mt-16">
        <h2 className="text-2xl font-bold text-gray-900 text-center mb-8">
          Was ist in jedem Plan enthalten?
        </h2>
        <div className="bg-white border border-gray-200 rounded-2xl overflow-hidden">
          {/* Table header */}
          <div className="grid grid-cols-[220px_repeat(6,1fr)_120px] bg-gray-50 border-b border-gray-200">
            <div className="p-4" />
            {PLANS.map((p) => (
              <div
                key={p.key}
                className={`p-4 text-center border-l border-gray-200 ${
                  p.highlight ? "bg-indigo-50" : ""
                }`}
              >
                <p className="text-xs font-bold text-gray-900">{p.name}</p>
                <p className="text-xs text-gray-500 mt-0.5">
                  {yearly ? `€${p.yearlyPrice}` : `€${p.monthlyPrice}`}/Mo.
                </p>
              </div>
            ))}
            <div className="p-4 text-center border-l border-gray-200 bg-[#1a1a2e]">
              <p className="text-xs font-bold text-white">Enterprise</p>
              <p className="text-xs text-gray-400 mt-0.5">Auf Anfrage</p>
            </div>
          </div>

          {/* Feature rows */}
          {FEATURE_ROWS.map((row, i) => (
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

      {/* FAQ teaser */}
      <div className="mt-16 text-center">
        <p className="text-gray-500 text-sm">
          Fragen zu den Plänen?{" "}
          <a href="mailto:support@deepglot.com" className="text-indigo-600 hover:underline">
            Schreib uns
          </a>{" "}
          – wir helfen gerne.
        </p>
      </div>
    </div>
  );
}

// Feature comparison data
const FEATURE_ROWS: Array<{
  label: string;
  values: (boolean | string)[];
  enterprise: boolean | string;
}> = [
  {
    label: "Wörter / Monat",
    values: ["2.000", "10.000", "50.000", "200.000", "1 Mio.", "5 Mio."],
    enterprise: "Individuell",
  },
  {
    label: "Übersetzungssprachen",
    values: ["1", "1", "3", "5", "10", "20"],
    enterprise: "Unbegrenzt",
  },
  {
    label: "Projekte",
    values: ["1", "2", "3", "5", "10", "25"],
    enterprise: "Unbegrenzt",
  },
  {
    label: "KI-Übersetzung (DeepL)",
    values: [true, true, true, true, true, true],
    enterprise: true,
  },
  {
    label: "Glossar",
    values: [true, true, true, true, true, true],
    enterprise: true,
  },
  {
    label: "Medien-Übersetzung",
    values: [false, true, true, true, true, true],
    enterprise: true,
  },
  {
    label: "Auto-Weiterleitung",
    values: [false, true, true, true, true, true],
    enterprise: true,
  },
  {
    label: "Statistiken",
    values: [false, false, true, true, true, true],
    enterprise: true,
  },
  {
    label: "URL-Slugs übersetzen",
    values: [false, false, false, true, true, true],
    enterprise: true,
  },
  {
    label: "Visueller Editor",
    values: [false, false, false, true, true, true],
    enterprise: true,
  },
  {
    label: "Export & Import (CSV/PO)",
    values: [false, false, false, false, true, true],
    enterprise: true,
  },
  {
    label: "OpenAI (kontextsensitiv)",
    values: [false, false, false, false, true, true],
    enterprise: true,
  },
  {
    label: "Top-Level-Domain Support",
    values: [false, false, false, false, false, true],
    enterprise: true,
  },
  {
    label: "Premium Support (SLA)",
    values: [false, false, false, false, false, true],
    enterprise: true,
  },
  {
    label: "SAML SSO",
    values: [false, false, false, false, false, false],
    enterprise: true,
  },
  {
    label: "Dedizierter Vertrag (DPA)",
    values: [false, false, false, false, false, false],
    enterprise: true,
  },
];
