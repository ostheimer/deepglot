export type SiteLocale = "en" | "de";

export const DEFAULT_MARKETING_LOCALE: SiteLocale = "en";
export const SITE_LOCALE_COOKIE = "deepglot-locale";
export const SITE_LOCALES: SiteLocale[] = ["en", "de"];

const EXTERNAL_TO_INTERNAL_SEGMENT: Record<string, string> = {
  projects: "projekte",
  new: "neu",
  translations: "uebersetzungen",
  languages: "sprachen",
  glossary: "glossar",
  visual: "visuell",
  pros: "profis",
  stats: "statistiken",
  requests: "anfragen",
  "page-views": "seitenaufrufe",
  settings: "einstellungen",
  "language-model": "sprachmodell",
  exclusions: "ausnahmen",
  subscription: "abonnement",
  overview: "uebersicht",
  billing: "karte-rechnungen",
  usage: "nutzung",
};

const INTERNAL_TO_EXTERNAL_SEGMENT: Record<string, string> = {
  preise: "pricing",
  anmelden: "login",
  registrieren: "signup",
  projekte: "projects",
  neu: "new",
  uebersetzungen: "translations",
  sprachen: "languages",
  glossar: "glossary",
  visuell: "visual",
  profis: "pros",
  statistiken: "stats",
  anfragen: "requests",
  seitenaufrufe: "page-views",
  einstellungen: "settings",
  sprachmodell: "language-model",
  ausnahmen: "exclusions",
  abonnement: "subscription",
  uebersicht: "overview",
  "karte-rechnungen": "billing",
  nutzung: "usage",
};

export function getDocumentLocale(pathname: string): SiteLocale {
  return pathname === "/de" || pathname.startsWith("/de/") ? "de" : "en";
}

export function stripLocalePrefix(pathname: string) {
  if (pathname === "/de") {
    return { locale: "de" as SiteLocale, pathname: "/" };
  }

  if (pathname.startsWith("/de/")) {
    return {
      locale: "de" as SiteLocale,
      pathname: pathname.slice(3) || "/",
    };
  }

  return {
    locale: "en" as SiteLocale,
    pathname: pathname || "/",
  };
}

export function withLocalePrefix(pathname: string, locale: SiteLocale) {
  if (locale === "en") {
    return pathname === "" ? "/" : pathname;
  }

  if (pathname === "/") {
    return "/de";
  }

  return `/de${pathname}`;
}

function mapSegments(pathname: string, segmentMap: Record<string, string>) {
  if (pathname === "/") return "/";

  const mapped = pathname
    .split("/")
    .filter(Boolean)
    .map((segment) => segmentMap[segment] ?? segment);

  return `/${mapped.join("/")}`;
}

function isNonLocalizedPath(pathname: string) {
  return pathname === "/api" || pathname.startsWith("/api/");
}

export function toInternalPath(pathname: string) {
  const { pathname: withoutLocale } = stripLocalePrefix(pathname);
  if (isNonLocalizedPath(withoutLocale)) {
    return withoutLocale;
  }
  return mapSegments(withoutLocale, EXTERNAL_TO_INTERNAL_SEGMENT);
}

export function toCanonicalExternalPath(pathname: string) {
  const { pathname: withoutLocale } = stripLocalePrefix(pathname);
  if (isNonLocalizedPath(withoutLocale)) {
    return withoutLocale;
  }
  return mapSegments(withoutLocale, INTERNAL_TO_EXTERNAL_SEGMENT);
}

export function getLocalizedPathname(pathname: string, locale: SiteLocale) {
  return withLocalePrefix(toCanonicalExternalPath(pathname), locale);
}

export function getLegacyPublicRedirect(pathname: string) {
  const { locale, pathname: withoutLocale } = stripLocalePrefix(pathname);
  const canonicalBasePath = toCanonicalExternalPath(withoutLocale);

  if (canonicalBasePath === withoutLocale) {
    return null;
  }

  return withLocalePrefix(canonicalBasePath, locale === "de" ? "de" : "de");
}

export function getMarketingPath(
  locale: SiteLocale,
  route:
    | "home"
    | "pricing"
    | "login"
    | "signup"
    | "forgotPassword"
    | "resetPassword"
    | "acceptInvite"
) {
  const localizedPaths = {
    home: "/",
    pricing: "/pricing",
    login: "/login",
    signup: "/signup",
    forgotPassword: "/forgot-password",
    resetPassword: "/reset-password",
    acceptInvite: "/accept-invite",
  } as const;

  return withLocalePrefix(localizedPaths[route], locale);
}
