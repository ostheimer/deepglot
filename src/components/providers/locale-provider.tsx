"use client";

import { createContext, useContext } from "react";
import { usePathname } from "next/navigation";

import { getDocumentLocale, type SiteLocale } from "@/lib/site-locale";

const LocaleContext = createContext<SiteLocale>("en");

export function LocaleProvider({
  locale,
  children,
}: {
  locale: SiteLocale;
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const currentPathname =
    typeof window === "undefined" ? pathname : window.location.pathname;
  const derivedLocale = getDocumentLocale(currentPathname || "/") || locale;

  return <LocaleContext.Provider value={derivedLocale}>{children}</LocaleContext.Provider>;
}

export function useLocale() {
  return useContext(LocaleContext);
}
