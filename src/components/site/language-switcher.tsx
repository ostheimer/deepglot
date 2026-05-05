"use client";

import { Globe } from "lucide-react";
import { usePathname, useSearchParams } from "next/navigation";

import { useLocale } from "@/components/providers/locale-provider";
import {
  getLocalizedPathname,
  SITE_LOCALES,
  type SiteLocale,
} from "@/lib/site-locale";

const LABELS = {
  en: { short: "EN", label: "English" },
  de: { short: "DE", label: "Deutsch" },
} as const;

type LanguageSwitcherProps = {
  compact?: boolean;
};

export function LanguageSwitcher({ compact = false }: LanguageSwitcherProps) {
  const locale = useLocale();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const currentPathname =
    typeof window === "undefined" ? pathname : window.location.pathname;
  const currentLocale: SiteLocale =
    currentPathname === "/de" || currentPathname.startsWith("/de/")
      ? "de"
      : locale;

  function getTargetUrl(targetLocale: SiteLocale) {
    const targetPath = getLocalizedPathname(currentPathname, targetLocale);
    const query = searchParams.toString();
    const hash =
      typeof window === "undefined" ? "" : window.location.hash;

    return `${query ? `${targetPath}?${query}` : targetPath}${hash}`;
  }

  return (
    <div className={`inline-flex items-center gap-1 rounded-lg border border-gray-200 bg-white p-1 ${compact ? "" : "shadow-sm"}`}>
      <div className="flex items-center gap-1.5 px-2 text-xs font-medium text-gray-500">
        <Globe className="h-3.5 w-3.5" />
        {!compact && <span>{LABELS[currentLocale].short}</span>}
      </div>
      {SITE_LOCALES.map((value) => {
        const isActive = value === currentLocale;
        const href = getTargetUrl(value);

        return (
          <a
            key={value}
            href={href}
            onClick={(event) => {
              // The URL hash is browser-only. Keep the link usable without JS,
              // then preserve the current hash once the hydrated handler runs.
              event.preventDefault();
              window.location.assign(getTargetUrl(value));
            }}
            className={`rounded-md px-2.5 py-1 text-xs font-medium transition-colors ${
              isActive
                ? "bg-indigo-600 text-white"
                : "text-gray-600 hover:bg-gray-100 hover:text-gray-900"
            }`}
            aria-current={isActive ? "true" : undefined}
            title={LABELS[value].label}
          >
            {compact ? LABELS[value].short : LABELS[value].label}
          </a>
        );
      })}
    </div>
  );
}
