"use client";

import Image from "next/image";
import { useEffect, useState } from "react";
import {
  getHeroPreviewLanguageCode,
  getHeroPreviewTabs,
  HERO_PREVIEW_LANGUAGES,
  type HeroPreviewLanguageCode,
} from "@/lib/hero-language-preview";
import type { SiteLocale } from "@/lib/site-locale";
import { uiText } from "@/lib/static-copy";

export function HeroLanguagePreview({ locale }: { locale: SiteLocale }) {
  const initialCode = getHeroPreviewLanguageCode(locale);
  const [activeCode, setActiveCode] =
    useState<HeroPreviewLanguageCode>(initialCode);

  useEffect(() => {
    setActiveCode(initialCode);
  }, [initialCode]);

  const activeLanguage =
    HERO_PREVIEW_LANGUAGES.find((language) => language.code === activeCode) ??
    HERO_PREVIEW_LANGUAGES[0];
  const previewTabs = getHeroPreviewTabs(initialCode);

  return (
    <div
      data-testid="hero-language-preview"
      className="relative pb-8 sm:pb-4"
    >
      <div className="overflow-hidden rounded-[18px] border border-[#14212d]/70 bg-white shadow-[0_24px_70px_rgba(6,21,33,0.13)]">
        <div className="flex h-12 items-center justify-between border-b border-black/10 bg-[#fbfaf7] px-4 sm:h-14 sm:px-6">
          <span className="text-sm font-extrabold tracking-[-0.03em] text-[#071521] sm:text-base">
            MAYER &amp; CO
          </span>
          <div className="hidden items-center gap-5 text-[10px] font-medium text-[#23313d] sm:flex">
            <span>{activeLanguage.navigation.services}</span>
            <span>{activeLanguage.navigation.projects}</span>
            <span>{activeLanguage.navigation.about}</span>
            <span>{activeLanguage.navigation.contact}</span>
          </div>
          <span className="rounded-sm bg-[#071521] px-3 py-1.5 text-[9px] font-semibold text-white sm:px-4">
            {activeLanguage.navigation.quote}
          </span>
        </div>

        <div className="relative aspect-[16/7.8] min-h-[245px] overflow-hidden sm:min-h-[300px]">
          <Image
            src="/marketing/austrian-interior-hero.png"
            alt={uiText(
              locale,
              "Modern Austrian architecture project with warm wood and large windows",
              "Modernes österreichisches Architekturprojekt mit warmem Holz und großen Fenstern"
            )}
            fill
            className="object-cover"
            sizes="(max-width: 1024px) 100vw, 58vw"
            priority
          />
          <div
            key={activeLanguage.code}
            aria-live="polite"
            className="absolute inset-y-0 left-0 flex w-[64%] flex-col justify-center px-5 text-white sm:w-[58%] sm:px-9"
          >
            <p className="max-w-[18ch] text-2xl font-extrabold leading-[1.04] tracking-[-0.04em] sm:text-3xl lg:text-[1.95rem]">
              {activeLanguage.heading}
            </p>
            <p className="mt-3 hidden max-w-[40ch] text-[11px] leading-relaxed text-white/80 sm:block">
              {activeLanguage.body}
            </p>
            <span className="mt-5 w-fit rounded-sm bg-white px-4 py-2 text-[10px] font-bold text-[#071521]">
              {activeLanguage.cta}
            </span>
          </div>
          <div
            data-testid="translation-cache-status"
            className="absolute top-4 right-4 flex items-center gap-2 rounded-full border border-white/30 bg-[#071521]/85 px-3 py-2 text-[10px] font-semibold text-white shadow-lg backdrop-blur-sm sm:top-5 sm:right-5 sm:text-xs"
          >
            <span className="h-2 w-2 rounded-full bg-[#42c5a4] shadow-[0_0_0_3px_rgba(66,197,164,0.2)]" />
            {uiText(locale, "Served from the local translation cache", "Aus dem lokalen Übersetzungs-Cache")}
          </div>
        </div>
      </div>

      <div
        role="tablist"
        aria-label={uiText(locale, "Preview language", "Vorschausprache")}
        className="absolute bottom-0 left-1/2 grid w-[78%] -translate-x-1/2 grid-cols-2 rounded-md border border-black/10 bg-white p-1.5 shadow-[0_16px_40px_rgba(6,21,33,0.12)] sm:grid-cols-4 sm:p-2"
      >
        {previewTabs.map((language) => {
          const active = language.code === activeCode;
          return (
            <button
              key={language.code}
              type="button"
              role="tab"
              aria-selected={active}
              onClick={() => setActiveCode(language.code)}
              className={`relative px-2 py-2.5 text-xs font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#f03b22] sm:text-sm ${
                active ? "text-[#071521]" : "text-[#53606b] hover:text-[#c62812]"
              }`}
            >
              {language.label}
              {active && (
                <span className="absolute inset-x-3 bottom-0 h-0.5 rounded-full bg-[#d92f19]" />
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}
