"use client";

import { createContext, useContext } from "react";

import type { SiteLocale } from "@/lib/site-locale";

const LocaleContext = createContext<SiteLocale>("en");

export function LocaleProvider({
  locale,
  children,
}: {
  locale: SiteLocale;
  children: React.ReactNode;
}) {
  return <LocaleContext.Provider value={locale}>{children}</LocaleContext.Provider>;
}

export function useLocale() {
  return useContext(LocaleContext);
}
