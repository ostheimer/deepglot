"use client";

import { createContext, useContext } from "react";
import { usePathname } from "next/navigation";

import type { SiteLocale } from "@/lib/site-locale";

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
  const derivedLocale =
    currentPathname === "/de" || currentPathname.startsWith("/de/") ? "de" : locale;

  return <LocaleContext.Provider value={derivedLocale}>{children}</LocaleContext.Provider>;
}

export function useLocale() {
  return useContext(LocaleContext);
}
