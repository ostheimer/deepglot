import { describe, it } from "node:test";
import assert from "node:assert";

import {
  BILLING_PLAN_KEYS,
  BILLING_PLANS,
  computeYearlyTotalCents,
  formatStripeProductDescription,
  formatYearlyMonthlyEquivalentCents,
  getEffectiveWordsLimit,
  getProjectsLimitForPlan,
  getStripePriceIdFromEnv,
  resolveBillingPlanKey,
  type BillingPlanKey,
} from "./billing-plans";

describe("billing-plans", () => {
  it("exposes the seven plan keys in marketing order", () => {
    assert.deepEqual(BILLING_PLAN_KEYS, [
      "FREE",
      "STARTER",
      "BUSINESS",
      "PRO",
      "ADVANCED",
      "EXTENDED",
      "ENTERPRISE",
    ]);
  });

  it("matches the agreed monthly prices in cents and word limits", () => {
    const expectations: Array<{
      key: BillingPlanKey;
      monthlyCents: number;
      yearlyCents: number;
      wordsLimit: number;
      languagesLimit: number;
      projectsLimit: number;
    }> = [
      { key: "FREE", monthlyCents: 0, yearlyCents: 0, wordsLimit: 10_000, languagesLimit: 1, projectsLimit: 1 },
      { key: "STARTER", monthlyCents: 1300, yearlyCents: 13_000, wordsLimit: 25_000, languagesLimit: 2, projectsLimit: 2 },
      { key: "BUSINESS", monthlyCents: 2500, yearlyCents: 25_000, wordsLimit: 50_000, languagesLimit: 3, projectsLimit: 3 },
      { key: "PRO", monthlyCents: 6900, yearlyCents: 69_000, wordsLimit: 200_000, languagesLimit: 5, projectsLimit: 5 },
      { key: "ADVANCED", monthlyCents: 25_900, yearlyCents: 259_000, wordsLimit: 1_000_000, languagesLimit: 10, projectsLimit: 10 },
      { key: "EXTENDED", monthlyCents: 59_900, yearlyCents: 599_000, wordsLimit: 5_000_000, languagesLimit: 20, projectsLimit: 25 },
      { key: "ENTERPRISE", monthlyCents: null, yearlyCents: null, wordsLimit: 20_000_000, languagesLimit: 50, projectsLimit: 100 },
    ] as never;

    for (const expectation of expectations) {
      const plan = BILLING_PLANS[expectation.key];
      assert.equal(plan.monthlyPriceCents, expectation.monthlyCents, `${expectation.key} monthly`);
      assert.equal(plan.yearlyPriceCents, expectation.yearlyCents, `${expectation.key} yearly`);
      assert.equal(plan.wordsLimit, expectation.wordsLimit, `${expectation.key} words`);
      assert.equal(plan.languagesLimit, expectation.languagesLimit, `${expectation.key} languages`);
      assert.equal(plan.projectsLimit, expectation.projectsLimit, `${expectation.key} projects`);
    }
  });

  it("resolveBillingPlanKey maps PROFESSIONAL alias and unknown plans safely", () => {
    assert.equal(resolveBillingPlanKey("PROFESSIONAL"), "PRO");
    assert.equal(resolveBillingPlanKey("PRO"), "PRO");
    assert.equal(resolveBillingPlanKey("not-a-plan"), "FREE");
    assert.equal(resolveBillingPlanKey(null), "FREE");
  });

  it("getProjectsLimitForPlan returns BILLING_PLANS ceilings for every paid tier", () => {
    assert.equal(getProjectsLimitForPlan("PRO"), BILLING_PLANS.PRO.projectsLimit);
    assert.equal(getProjectsLimitForPlan("BUSINESS"), BILLING_PLANS.BUSINESS.projectsLimit);
    assert.equal(getProjectsLimitForPlan("ADVANCED"), BILLING_PLANS.ADVANCED.projectsLimit);
    assert.equal(getProjectsLimitForPlan("EXTENDED"), BILLING_PLANS.EXTENDED.projectsLimit);
    assert.equal(getProjectsLimitForPlan("PROFESSIONAL"), BILLING_PLANS.PRO.projectsLimit);
    // Regression: stale hardcoded map treated unknown PRO as 1 project.
    assert.equal(getProjectsLimitForPlan("PRO"), 5);
  });

  it("computes yearly billing as monthly * 10 (Weglot-style 2 months free) for paid plans", () => {
    // Yearly billing model: customer pays for 10 months and gets 12 months access.
    assert.equal(computeYearlyTotalCents("STARTER"), 13_000); // 10 * 1300
    assert.equal(computeYearlyTotalCents("BUSINESS"), 25_000); // 10 * 2500
    assert.equal(computeYearlyTotalCents("PRO"), 69_000); // 10 * 6900
    assert.equal(computeYearlyTotalCents("ADVANCED"), 259_000); // 10 * 25_900
    assert.equal(computeYearlyTotalCents("EXTENDED"), 599_000); // 10 * 59_900
    assert.equal(computeYearlyTotalCents("FREE"), 0);
    assert.equal(computeYearlyTotalCents("ENTERPRISE"), null);
  });

  it("derives the yearly plan's effective monthly equivalent in cents", () => {
    // The marketing toggle shows "€X/mo" when yearly is selected; that value is
    // (yearlyTotal / 12) rounded the same way the UI rounds — to whole euros.
    assert.equal(formatYearlyMonthlyEquivalentCents("STARTER"), 1083); // 13_000 / 12 = 1083.33
    assert.equal(formatYearlyMonthlyEquivalentCents("PRO"), 5750); // 69_000 / 12 = 5750
    assert.equal(formatYearlyMonthlyEquivalentCents("EXTENDED"), 49_917); // 599_000 / 12 = 49_916.66
    assert.equal(formatYearlyMonthlyEquivalentCents("FREE"), 0);
    assert.equal(formatYearlyMonthlyEquivalentCents("ENTERPRISE"), null);
  });

  it("returns the matching Stripe price id from the configured environment", () => {
    const env = {
      STRIPE_PRICE_STARTER_MONTHLY: "price_starter_m",
      STRIPE_PRICE_STARTER_YEARLY: "price_starter_y",
      STRIPE_PRICE_PRO_MONTHLY: "price_pro_m",
    } satisfies Record<string, string>;

    assert.equal(getStripePriceIdFromEnv("STARTER", "monthly", env), "price_starter_m");
    assert.equal(getStripePriceIdFromEnv("STARTER", "yearly", env), "price_starter_y");
    assert.equal(getStripePriceIdFromEnv("PRO", "monthly", env), "price_pro_m");
    assert.equal(getStripePriceIdFromEnv("PRO", "yearly", env), null);
    assert.equal(getStripePriceIdFromEnv("FREE", "monthly", env), null);
    assert.equal(getStripePriceIdFromEnv("ENTERPRISE", "monthly", env), null);
  });

  it("exposes the seven tiers in ascending word-volume order so the marketing slider can step through them", () => {
    const wordsLimits = BILLING_PLAN_KEYS.map((key) => BILLING_PLANS[key].wordsLimit);
    const sorted = [...wordsLimits].sort((a, b) => a - b);
    assert.deepEqual(wordsLimits, sorted);
  });

  it("getEffectiveWordsLimit grants the full quota only to ACTIVE and TRIALING subscriptions", () => {
    const freeLimit = BILLING_PLANS.FREE.wordsLimit;
    const proLimit = BILLING_PLANS.PRO.wordsLimit;

    assert.equal(getEffectiveWordsLimit(null), freeLimit);
    assert.equal(getEffectiveWordsLimit(undefined), freeLimit);
    assert.equal(
      getEffectiveWordsLimit({ status: "ACTIVE", wordsLimit: proLimit }),
      proLimit
    );
    assert.equal(
      getEffectiveWordsLimit({ status: "TRIALING", wordsLimit: proLimit }),
      proLimit
    );

    // Grace + soft-cap: PAST_DUE keeps the API alive but cannot consume more
    // than the FREE quota for new translations until billing is restored.
    assert.equal(
      getEffectiveWordsLimit({ status: "PAST_DUE", wordsLimit: proLimit }),
      freeLimit
    );
    assert.equal(
      getEffectiveWordsLimit({ status: "INACTIVE", wordsLimit: proLimit }),
      freeLimit
    );
    assert.equal(
      getEffectiveWordsLimit({ status: "CANCELED", wordsLimit: proLimit }),
      freeLimit
    );

    // A FREE-tier subscription is its own ceiling — soft-cap should not grant
    // a higher limit than the stored quota when that quota is already <= FREE.
    assert.equal(
      getEffectiveWordsLimit({ status: "PAST_DUE", wordsLimit: freeLimit }),
      freeLimit
    );
  });

  it("defaults to German so re-running scripts/stripe-setup.ts --mode live never swaps the customer-facing locale", () => {
    // The hand-curated descriptions on the existing live products are German.
    // Default-arg parity protects against a refactor accidentally pushing the
    // English variant to live.
    for (const key of BILLING_PLAN_KEYS) {
      assert.equal(
        formatStripeProductDescription(key),
        formatStripeProductDescription(key, "de")
      );
    }
  });

  it("renders the German Stripe product description for STARTER from BILLING_PLANS values", () => {
    const starter = BILLING_PLANS.STARTER;
    const description = formatStripeProductDescription("STARTER", "de");

    // Numeric facts derive from BILLING_PLANS — no hardcoded magic numbers.
    assert.ok(
      description.includes(starter.wordsLimit.toLocaleString("de-DE")),
      `STARTER de description must include ${starter.wordsLimit.toLocaleString("de-DE")}`
    );
    assert.ok(description.includes(`${starter.languagesLimit} Sprachen`));
    assert.ok(description.includes(`${starter.projectsLimit} Projekte`));
    assert.ok(description.includes("Wörter / Monat"));
    // Hand-curated tagline still present so Checkout copy stays >= today.
    assert.match(description, /kleine Websites/);
  });

  it("renders the English Stripe product description for STARTER from BILLING_PLANS values", () => {
    const starter = BILLING_PLANS.STARTER;
    const description = formatStripeProductDescription("STARTER", "en");

    assert.ok(
      description.includes(starter.wordsLimit.toLocaleString("en-US")),
      `STARTER en description must include ${starter.wordsLimit.toLocaleString("en-US")}`
    );
    assert.ok(description.includes(`${starter.languagesLimit} languages`));
    assert.ok(description.includes(`${starter.projectsLimit} projects`));
    assert.ok(description.includes("words/month"));
    assert.match(description, /small websites/);
  });

  it("renders the German Stripe product description for PRO from BILLING_PLANS values", () => {
    const pro = BILLING_PLANS.PRO;
    const description = formatStripeProductDescription("PRO", "de");

    assert.ok(
      description.includes(pro.wordsLimit.toLocaleString("de-DE")),
      `PRO de description must include ${pro.wordsLimit.toLocaleString("de-DE")}`
    );
    assert.ok(description.includes(`${pro.languagesLimit} Sprachen`));
    assert.ok(description.includes(`${pro.projectsLimit} Projekte`));
    assert.match(description, /professionellem Auftritt/);
  });

  it("renders the English Stripe product description for PRO from BILLING_PLANS values", () => {
    const pro = BILLING_PLANS.PRO;
    const description = formatStripeProductDescription("PRO", "en");

    assert.ok(
      description.includes(pro.wordsLimit.toLocaleString("en-US")),
      `PRO en description must include ${pro.wordsLimit.toLocaleString("en-US")}`
    );
    assert.ok(description.includes(`${pro.languagesLimit} languages`));
    assert.ok(description.includes(`${pro.projectsLimit} projects`));
    assert.match(description, /professional presence/);
  });

  it("exercises the singular pluralization branch on FREE in both locales", () => {
    const free = BILLING_PLANS.FREE;
    assert.equal(free.languagesLimit, 1);
    assert.equal(free.projectsLimit, 1);

    const de = formatStripeProductDescription("FREE", "de");
    assert.ok(de.includes(`${free.languagesLimit} Sprache,`));
    assert.ok(de.includes(`${free.projectsLimit} Projekt `));

    const en = formatStripeProductDescription("FREE", "en");
    assert.ok(en.includes(`${free.languagesLimit} language `));
    assert.ok(en.includes(`${free.projectsLimit} project `));
  });

  it("formatStripeProductDescription stays mechanically derived from BILLING_PLANS for every plan in both locales", () => {
    // Even if someone edits BILLING_PLANS in the future, both locale outputs
    // must contain the current numeric limits verbatim. This catches the bug
    // where someone bumps a limit but forgets to re-run the Stripe setup
    // script — at least the local string reflects the new value, so the next
    // run writes through to Stripe.
    const localeSpec = {
      de: {
        numberLocale: "de-DE",
        languageNoun: (n: number) => (n === 1 ? "Sprache" : "Sprachen"),
        projectNoun: (n: number) => (n === 1 ? "Projekt" : "Projekte"),
      },
      en: {
        numberLocale: "en-US",
        languageNoun: (n: number) => (n === 1 ? "language" : "languages"),
        projectNoun: (n: number) => (n === 1 ? "project" : "projects"),
      },
    } as const;

    for (const locale of ["de", "en"] as const) {
      const spec = localeSpec[locale];
      for (const key of BILLING_PLAN_KEYS) {
        const plan = BILLING_PLANS[key];
        const description = formatStripeProductDescription(key, locale);
        assert.ok(
          description.includes(plan.wordsLimit.toLocaleString(spec.numberLocale)),
          `${key} ${locale} description must include the words limit ${plan.wordsLimit}`
        );
        assert.ok(
          description.includes(`${plan.languagesLimit} ${spec.languageNoun(plan.languagesLimit)}`),
          `${key} ${locale} description must include the languages count`
        );
        assert.ok(
          description.includes(`${plan.projectsLimit} ${spec.projectNoun(plan.projectsLimit)}`),
          `${key} ${locale} description must include the projects count`
        );
      }
    }
  });

  it("never advertises any limit as 'unlimited' or 'unbegrenzt'", () => {
    const forbiddenPattern = /unlimited|unbegrenzt|infinity|infinite/i;
    for (const key of BILLING_PLAN_KEYS) {
      const plan = BILLING_PLANS[key];
      assert.equal(typeof plan.wordsLimit, "number", `${key} wordsLimit must be numeric`);
      assert.equal(typeof plan.languagesLimit, "number", `${key} languagesLimit must be numeric`);
      assert.equal(typeof plan.projectsLimit, "number", `${key} projectsLimit must be numeric`);
      assert.ok(Number.isFinite(plan.wordsLimit), `${key} wordsLimit must be finite`);
      assert.ok(Number.isFinite(plan.languagesLimit), `${key} languagesLimit must be finite`);
      assert.ok(Number.isFinite(plan.projectsLimit), `${key} projectsLimit must be finite`);
      assert.equal(forbiddenPattern.test(plan.name), false, `${key} name must not promise unlimited`);
    }
  });
});
