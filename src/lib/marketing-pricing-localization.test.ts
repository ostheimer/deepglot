import test from "node:test";
import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

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
