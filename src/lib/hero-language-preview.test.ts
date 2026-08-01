import assert from "node:assert/strict";
import test from "node:test";

import {
  getHeroPreviewLanguageCode,
  getHeroPreviewTabs,
  HERO_PREVIEW_LANGUAGES,
} from "./hero-language-preview";
import { SITE_LOCALES } from "./site-locale";

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

test("the showcase initially follows every selected site language", () => {
  assert.equal(getHeroPreviewLanguageCode("de"), "de");
  assert.equal(getHeroPreviewLanguageCode("en"), "en");
  assert.equal(getHeroPreviewLanguageCode("fr"), "fr");
  assert.equal(getHeroPreviewLanguageCode("it"), "it");

  for (const locale of SITE_LOCALES) {
    assert.equal(getHeroPreviewLanguageCode(locale), locale);
    assert.ok(HERO_PREVIEW_LANGUAGES.some((language) => language.code === locale), locale);
  }
});

test("Bulgarian starts with localized showcase navigation and hero copy", () => {
  const language = HERO_PREVIEW_LANGUAGES.find((candidate) => candidate.code === "bg");

  assert.ok(language, "missing Bulgarian showcase language");
  assert.notEqual(language.navigation.services, "Services");
  assert.notEqual(language.navigation.projects, "Projects");
  assert.notEqual(language.heading, "We create spaces that last.");
  assert.notEqual(language.body, "Thoughtful design, clean lines and sustainable materials – architecture with lasting impact.");
  assert.notEqual(language.cta, "Learn more");
});

test("the showcase keeps four tabs and includes the selected site language", () => {
  for (const locale of SITE_LOCALES) {
    const tabs = getHeroPreviewTabs(locale);
    assert.equal(tabs.length, 4, locale);
    assert.equal(new Set(tabs.map((language) => language.code)).size, 4, locale);
    assert.ok(tabs.some((language) => language.code === locale), locale);
  }
});
