import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { LocaleProvider } from "@/components/providers/locale-provider";
import { UsageCharts } from "@/components/abonnement/usage-charts";
import {
  BILLING_PLAN_KEYS,
  BILLING_PLANS,
  getProjectsLimitForPlan,
} from "./billing-plans";

test("usage page displays canonical project ceilings for every current plan", () => {
  for (const key of BILLING_PLAN_KEYS) {
    assert.equal(getProjectsLimitForPlan(key), BILLING_PLANS[key].projectsLimit, key);
  }

  const source = readFileSync(
    "src/app/(dashboard)/abonnement/nutzung/page.tsx",
    "utf8"
  );
  assert.match(source, /getProjectsLimitForPlan\(plan\)/);
  assert.doesNotMatch(source, /PLAN_LIMITS/);
});

function renderUsage(locale: "en" | "de", wordsLimit: number) {
  return renderToStaticMarkup(
    createElement(
      LocaleProvider,
      { locale } as Parameters<typeof LocaleProvider>[0],
      createElement(UsageCharts, {
        totalWords: 1_000,
        wordsLimit,
        planWordsLimit: 20_000_000,
        totalRequests: 7,
        pieWordData: [],
        pieRequestData: [],
        projectRows: [],
        projectCount: 2,
        projectsLimit: 100,
        membersCount: 3,
        langLimitPerProject: 50,
      })
    )
  );
}

test("DE/EN usage distinguishes the standard allowance from an effective override", () => {
  const en = renderUsage("en", 5_000_000);
  const de = renderUsage("de", 5_000_000);
  assert.match(en, /Standard plan allowance: 20,000,000 words \/ month/);
  assert.match(en, /Applicable monthly word limit: 5,000,000/);
  assert.match(de, /Standardkontingent des Plans: 20\.000\.000 Wörter \/ Monat/);
  assert.match(de, /Geltendes monatliches Wortlimit: 5\.000\.000/);
  assert.match(en, /2 \/ 100/);
  assert.doesNotMatch(en, />7 \/ [\d,]+</);
  assert.doesNotMatch(en, />3 \/ [\d,]+</);
});

test("usage omits the distinction when the effective and standard limits match", () => {
  assert.doesNotMatch(renderUsage("en", 20_000_000), /Standard plan allowance/);
  assert.doesNotMatch(renderUsage("de", 20_000_000), /Standardkontingent des Plans/);
});
