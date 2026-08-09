import assert from "node:assert/strict";
import test from "node:test";

import { getMarketingHeroLocale } from "./marketing-hero-locale";
import { SITE_LOCALES } from "./site-locale";
import { uiText } from "./static-copy";

test("the marketing hero localizes Austria and its 24-language message", () => {
  assert.equal(SITE_LOCALES.length, 24);

  for (const locale of SITE_LOCALES) {
    const presentation = getMarketingHeroLocale(locale);

    assert.match(presentation.eyebrow, new RegExp(`^${uiText(locale, "Austria")} · 24 `));
    assert.ok(presentation.eyebrow.includes(uiText(locale, "Languages")));
  }
});
