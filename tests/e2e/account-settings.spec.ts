import { expect, test } from "@playwright/test";

import { signInAsTestUser } from "./helpers";

test.describe("account settings", () => {
  test("saves profile fields through the user API", async ({ page }) => {
    await signInAsTestUser(page);
    await page.goto("/settings");

    await expect(
      page.getByRole("heading", { name: "My account" })
    ).toBeVisible();
    await expect(page.getByRole("button", { name: /^Save$/ })).toHaveCount(1);
    await expect(page.getByRole("switch")).toHaveCount(0);
    await expect(
      page.getByText("Preferences are not configurable yet")
    ).toBeVisible();
    await expect(
      page.getByText("2FA needs a dedicated enrollment and recovery flow.")
    ).toBeVisible();
    await expect(page.getByRole("button", { name: "Create" })).toBeDisabled();

    const email = `profile-${Date.now()}@example.com`;
    const profileRequests: unknown[] = [];

    await page.route("**/api/user", async (route) => {
      if (route.request().method() !== "PATCH") {
        await route.continue();
        return;
      }

      profileRequests.push(route.request().postDataJSON());
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ success: true }),
      });
    });

    await page.locator('input[type="email"]').first().fill(email);
    await page.getByPlaceholder("Enter first name").fill("Ada");
    await page.getByPlaceholder("Enter last name").fill("Lovelace");
    await page.getByRole("button", { name: /^Save$/ }).first().click();

    await expect(page.getByText("Profile saved.")).toBeVisible();
    expect(profileRequests).toEqual([
      { email, firstName: "Ada", lastName: "Lovelace" },
    ]);
  });
});
