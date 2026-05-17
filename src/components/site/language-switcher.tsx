"use client";

import { Check, ChevronDown, Globe } from "lucide-react";
import { usePathname, useSearchParams } from "next/navigation";

import { useLocale } from "@/components/providers/locale-provider";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  SITE_LOCALE_METADATA,
  getLocalizedPathname,
  getDocumentLocale,
  SITE_LOCALES,
  type SiteLocale,
} from "@/lib/site-locale";

type LanguageSwitcherProps = {
  compact?: boolean;
};

export function LanguageSwitcher({ compact = false }: LanguageSwitcherProps) {
  const locale = useLocale();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const currentPathname =
    typeof window === "undefined" ? pathname : window.location.pathname;
  const currentLocale: SiteLocale = getDocumentLocale(currentPathname || "/") || locale;

  function getTargetUrl(targetLocale: SiteLocale) {
    const targetPath = getLocalizedPathname(currentPathname, targetLocale);
    const query = searchParams.toString();
    const hash =
      typeof window === "undefined" ? "" : window.location.hash;

    return `${query ? `${targetPath}?${query}` : targetPath}${hash}`;
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          className={`inline-flex h-9 items-center gap-1.5 rounded-lg border border-gray-200 bg-white px-2.5 text-xs font-medium text-gray-700 transition-colors hover:bg-gray-50 ${
            compact ? "" : "shadow-sm"
          }`}
          aria-label="Language"
        >
          <Globe className="h-3.5 w-3.5 text-gray-500" />
          <span>
            {compact
              ? SITE_LOCALE_METADATA[currentLocale].shortLabel
              : SITE_LOCALE_METADATA[currentLocale].nativeName}
          </span>
          <ChevronDown className="h-3.5 w-3.5 text-gray-400" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="max-h-80 w-56 overflow-y-auto">
        {SITE_LOCALES.map((value) => {
          const isActive = value === currentLocale;
          const href = getTargetUrl(value);

          return (
            <DropdownMenuItem key={value} asChild>
              <a
                href={href}
                onClick={(event) => {
                  // The URL hash is browser-only. Keep the link usable without JS,
                  // then preserve the current hash once the hydrated handler runs.
                  event.preventDefault();
                  window.location.assign(getTargetUrl(value));
                }}
                aria-current={isActive ? "true" : undefined}
                title={SITE_LOCALE_METADATA[value].englishName}
              >
                <span className="w-8 text-xs font-semibold text-gray-500">
                  {SITE_LOCALE_METADATA[value].shortLabel}
                </span>
                <span className="flex-1">{SITE_LOCALE_METADATA[value].nativeName}</span>
                {isActive && <Check className="h-4 w-4 text-indigo-600" />}
              </a>
            </DropdownMenuItem>
          );
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
