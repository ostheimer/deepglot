import { describe, it } from "node:test";
import assert from "node:assert";

import {
  BILLING_PLAN_KEYS,
  BILLING_PLANS,
  computeYearlyTotalCents,
  formatYearlyMonthlyEquivalentCents,
  getStripePriceIdFromEnv,
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
      { key: "FREE", monthlyCents: 0, yearlyCents: 0, wordsLimit: 2_000, languagesLimit: 1, projectsLimit: 1 },
      { key: "STARTER", monthlyCents: 1300, yearlyCents: 13_000, wordsLimit: 10_000, languagesLimit: 1, projectsLimit: 2 },
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
