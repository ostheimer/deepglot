import assert from "node:assert/strict";
import test from "node:test";

import { splitMarketingHeroTitle } from "@/lib/marketing-hero-title";
import { SITE_LOCALES } from "@/lib/site-locale";
import { uiText } from "@/lib/static-copy";

const ENGLISH_TITLE = "Translate your WordPress site without subscription lock-in";
const GERMAN_TITLE = "Übersetze deine WordPress-Site ohne Abo-Falle";
const ENGLISH_HIGHLIGHT = "without subscription lock-in";
const GERMAN_HIGHLIGHT = "ohne Abo-Falle";

test("localized hero titles render once and only split an exact highlight", () => {
  for (const locale of SITE_LOCALES) {
    const title = uiText(locale, ENGLISH_TITLE, GERMAN_TITLE);
    const highlight = uiText(locale, ENGLISH_HIGHLIGHT, GERMAN_HIGHLIGHT);
    const parts = splitMarketingHeroTitle(title, highlight);
    const rendered = `${parts.before}${parts.highlight ?? ""}${parts.after}`;

    assert.equal(rendered, title, locale);
    assert.equal(parts.highlight !== null, title.includes(highlight), locale);
    assert.equal(rendered.indexOf(title), rendered.lastIndexOf(title), locale);
  }
});

test("does not append a translated highlight that is absent from the title", () => {
  assert.deepEqual(splitMarketingHeroTitle("Цялото заглавие", "акцент"), {
    before: "Цялото заглавие",
    highlight: null,
    after: "",
  });
});
