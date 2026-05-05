import { expect, test } from "@playwright/test";

import { signInAsTestUser } from "./helpers";

test.describe("subscription usage accessibility", () => {
  test("labels visible usage chart SVGs", async ({ page }) => {
    await signInAsTestUser(page);

    await page.goto("/subscription/usage");

    await expect(page.getByRole("heading", { name: "Usage" })).toBeVisible();

    const unlabeledCharts = page.locator(
      'svg[role="application"]:not([aria-label]), svg[role="img"]:not([aria-label])'
    );
    const unlabeledFocusableChartLayers = page.locator(
      'svg [tabindex="0"]:not([aria-label])'
    );

    await expect(unlabeledCharts).toHaveCount(0);
    await expect(unlabeledFocusableChartLayers).toHaveCount(0);
  });
});
