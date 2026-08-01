import {
  SITE_LOCALES,
  SITE_LOCALE_METADATA,
  type SiteLocale,
} from "@/lib/site-locale";
import { uiText } from "@/lib/static-copy";

type HeroPreviewLanguage = {
  code: SiteLocale;
  label: string;
  navigation: {
    services: string;
    projects: string;
    about: string;
    contact: string;
    quote: string;
  };
  heading: string;
  body: string;
  cta: string;
};

const CURATED_PREVIEW_LANGUAGES: Partial<
  Record<SiteLocale, Omit<HeroPreviewLanguage, "code">>
> = {
  de: {
    label: "Deutsch",
    navigation: {
      services: "Leistungen",
      projects: "Projekte",
      about: "Über uns",
      contact: "Kontakt",
      quote: "Angebot anfordern",
    },
    heading: "Wir gestalten Räume, die bleiben.",
    body: "Durchdachtes Design, klare Linien und nachhaltige Materialien – für Architektur, die wirkt.",
    cta: "Mehr erfahren",
  },
  en: {
    label: "English",
    navigation: {
      services: "Services",
      projects: "Projects",
      about: "About us",
      contact: "Contact",
      quote: "Request a quote",
    },
    heading: "We create spaces that last.",
    body: "Thoughtful design, clean lines and sustainable materials – architecture with lasting impact.",
    cta: "Learn more",
  },
  fr: {
    label: "Français",
    navigation: {
      services: "Services",
      projects: "Projets",
      about: "À propos",
      contact: "Contact",
      quote: "Demander une offre",
    },
    heading: "Nous créons des espaces durables.",
    body: "Un design réfléchi, des lignes claires et des matériaux durables – une architecture qui marque.",
    cta: "En savoir plus",
  },
  it: {
    label: "Italiano",
    navigation: {
      services: "Servizi",
      projects: "Progetti",
      about: "Chi siamo",
      contact: "Contatti",
      quote: "Richiedi un preventivo",
    },
    heading: "Creiamo spazi che durano.",
    body: "Design accurato, linee pulite e materiali sostenibili – un’architettura che lascia il segno.",
    cta: "Scopri di più",
  },
};

function createPreviewLanguage(locale: SiteLocale): HeroPreviewLanguage {
  const curated = CURATED_PREVIEW_LANGUAGES[locale];
  if (curated) return { code: locale, ...curated };

  return {
    code: locale,
    label: SITE_LOCALE_METADATA[locale].nativeName,
    navigation: {
      services: uiText(locale, "Services", "Leistungen"),
      projects: uiText(locale, "Projects", "Projekte"),
      about: uiText(locale, "About us", "Über uns"),
      contact: uiText(locale, "Contact", "Kontakt"),
      quote: uiText(locale, "Request a quote", "Angebot anfordern"),
    },
    heading: uiText(
      locale,
      "We create spaces that last.",
      "Wir gestalten Räume, die bleiben."
    ),
    body: uiText(
      locale,
      "Thoughtful design, clean lines and sustainable materials – architecture with lasting impact.",
      "Durchdachtes Design, klare Linien und nachhaltige Materialien – für Architektur, die wirkt."
    ),
    cta: uiText(locale, "Learn more", "Mehr erfahren"),
  };
}

export const HERO_PREVIEW_LANGUAGES: readonly HeroPreviewLanguage[] =
  SITE_LOCALES.map(createPreviewLanguage);

export type HeroPreviewLanguageCode = SiteLocale;

export function getHeroPreviewLanguageCode(
  locale: SiteLocale
): HeroPreviewLanguageCode {
  return locale;
}

const DEFAULT_PREVIEW_CODES: readonly HeroPreviewLanguageCode[] = [
  "de",
  "en",
  "fr",
  "it",
];

export function getHeroPreviewTabs(
  selectedCode: HeroPreviewLanguageCode
): readonly HeroPreviewLanguage[] {
  const codes = DEFAULT_PREVIEW_CODES.includes(selectedCode)
    ? DEFAULT_PREVIEW_CODES
    : [selectedCode, ...DEFAULT_PREVIEW_CODES.slice(0, 3)];

  return codes.map(
    (code) =>
      HERO_PREVIEW_LANGUAGES.find((language) => language.code === code) ??
      HERO_PREVIEW_LANGUAGES[0]
  );
}
