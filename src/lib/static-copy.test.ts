import test from "node:test";
import assert from "node:assert/strict";

import { SITE_LOCALES } from "@/lib/site-locale";
import { uiText } from "@/lib/static-copy";

test("keeps the Deepglot brand name untranslated in static copy", () => {
  for (const locale of SITE_LOCALES) {
    assert.equal(uiText(locale, "Deepglot"), "Deepglot", locale);
  }
});
