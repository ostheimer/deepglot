export const HERO_PREVIEW_LANGUAGES = [
  {
    code: "de",
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
  {
    code: "en",
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
  {
    code: "fr",
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
  {
    code: "it",
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
] as const;

export type HeroPreviewLanguageCode = (typeof HERO_PREVIEW_LANGUAGES)[number]["code"];
