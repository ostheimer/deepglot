import assert from "node:assert/strict";
import test from "node:test";

import { pageViewPrivacyDisclosure, pageViewText } from "@/lib/page-view-copy";
import { SITE_LOCALES } from "@/lib/site-locale";

test("page-view consent and retention disclosures are localized for every supported locale", () => {
  const englishDisclosure = pageViewPrivacyDisclosure("en");

  for (const locale of SITE_LOCALES) {
    const disclosure = pageViewPrivacyDisclosure(locale);

    assert.match(disclosure, /90/, `${locale}: 90-day retention is missing`);
    assert.ok(pageViewText(locale, "disable").length > 0, locale);

    if (locale !== "en") {
      assert.notEqual(disclosure, englishDisclosure, `${locale}: disclosure falls back to English`);
    }
  }
});

test("German page-view copy uses real umlauts and explicit consent", () => {
  assert.match(pageViewText("de", "consent"), /ausdrücklicher Zustimmung/);
  assert.match(pageViewText("de", "retention"), /gelöscht/);
  assert.match(pageViewText("de", "history"), /Übersetzungsanfragen/);
});
