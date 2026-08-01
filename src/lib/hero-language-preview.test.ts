import assert from "node:assert/strict";
import test from "node:test";

import { HERO_PREVIEW_LANGUAGES } from "./hero-language-preview";

const EXPECTED_SHOWCASE_COPY = {
  de: {
    navigation: {
      services: "Leistungen",
      projects: "Projekte",
      about: "Über uns",
      contact: "Kontakt",
      quote: "Angebot anfordern",
    },
    heading: "Wir gestalten Räume, die bleiben.",
    cta: "Mehr erfahren",
  },
  en: {
    navigation: {
      services: "Services",
      projects: "Projects",
      about: "About us",
      contact: "Contact",
      quote: "Request a quote",
    },
    heading: "We create spaces that last.",
    cta: "Learn more",
  },
  fr: {
    navigation: {
      services: "Services",
      projects: "Projets",
      about: "À propos",
      contact: "Contact",
      quote: "Demander une offre",
    },
    heading: "Nous créons des espaces durables.",
    cta: "En savoir plus",
  },
  it: {
    navigation: {
      services: "Servizi",
      projects: "Progetti",
      about: "Chi siamo",
      contact: "Contatti",
      quote: "Richiedi un preventivo",
    },
    heading: "Creiamo spazi che durano.",
    cta: "Scopri di più",
  },
} as const;

test("the showcase translates its complete navigation with the selected preview language", () => {
  for (const [code, expected] of Object.entries(EXPECTED_SHOWCASE_COPY)) {
    const language = HERO_PREVIEW_LANGUAGES.find((candidate) => candidate.code === code);

    assert.ok(language, `missing showcase language ${code}`);
    assert.deepEqual(language.navigation, expected.navigation);
    assert.equal(language.heading, expected.heading);
    assert.equal(language.cta, expected.cta);
  }
});
