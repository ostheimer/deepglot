import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { STATIC_MESSAGES } from "@/lib/static-messages";

test("localizes Bulgarian marketing pricing units", async () => {
  const pricingGridModule = await import("@/components/marketing/pricing-grid");
  const { PricingGrid } = (
    (pricingGridModule as { default?: unknown }).default ?? pricingGridModule
  ) as typeof import("@/components/marketing/pricing-grid");

  const html = renderToStaticMarkup(createElement(PricingGrid, { locale: "bg" }));

  assert.match(html, /€69/);
  assert.doesNotMatch(html, /\/mo\./);
  assert.doesNotMatch(html, />1M</);
  assert.match(html, /\/месец/);
  assert.match(html, /1\s+млн\./);
});

test("does not advertise media translation before the feature exists (#259)", async () => {
  const pricingSource = readFileSync(
    path.join(
      process.cwd(),
      "src",
      "components",
      "marketing",
      "pricing-grid.tsx"
    ),
    "utf8"
  );
  const pricingGridModule = await import("@/components/marketing/pricing-grid");
  const { PricingGrid } = (
    (pricingGridModule as { default?: unknown }).default ?? pricingGridModule
  ) as typeof import("@/components/marketing/pricing-grid");

  const englishHtml = renderToStaticMarkup(
    createElement(PricingGrid, { locale: "en" })
  );
  const germanHtml = renderToStaticMarkup(
    createElement(PricingGrid, { locale: "de" })
  );

  assert.doesNotMatch(pricingSource, /Media translation|Medien-Übersetzung/);
  assert.doesNotMatch(englishHtml, /Media translation/);
  assert.doesNotMatch(germanHtml, /Medien-Übersetzung/);
  for (const [locale, messages] of Object.entries(STATIC_MESSAGES)) {
    assert.equal(
      Object.hasOwn(messages, "Media translation"),
      false,
      `${locale} must not retain the unsupported pricing claim`
    );
  }
});

test("does not advertise SAML SSO before enterprise identity is implemented (#318)", () => {
  const pricingSource = readFileSync(
    path.join(
      process.cwd(),
      "src",
      "components",
      "marketing",
      "pricing-grid.tsx"
    ),
    "utf8"
  );

  assert.equal(
    /["']SAML SSO["']/.test(pricingSource),
    false,
    "Enterprise pricing must not advertise unimplemented SAML SSO"
  );
  for (const [locale, messages] of Object.entries(STATIC_MESSAGES)) {
    assert.equal(
      Object.hasOwn(messages, "SAML SSO"),
      false,
      `${locale} must not retain the unsupported enterprise SSO claim`
    );
  }
});
