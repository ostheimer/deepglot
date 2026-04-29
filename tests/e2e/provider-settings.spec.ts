import { expect, test } from "@playwright/test";

test.describe("provider settings", () => {
  test("saves the mock translation provider without real provider secrets", async ({
    page,
  }) => {
    await page.goto("/login");

    const testLoginButton = page.getByRole("button", {
      name: /sign in as test user/i,
    });
    if (!(await testLoginButton.isVisible().catch(() => false))) {
      test.skip(true, "Test login is not enabled in this environment.");
    }

    await testLoginButton.click();
    await page.waitForURL(/\/dashboard$/, { timeout: 15_000 }).catch(() => null);
    if (!/\/dashboard$/.test(new URL(page.url()).pathname)) {
      test.skip(true, "Test login could not create an authenticated session.");
    }

    const projectLink = page
      .locator('a[href*="/projects/"][href*="/translations/languages"]')
      .first();
    if (!(await projectLink.isVisible().catch(() => false))) {
      test.skip(true, "No seeded test project is available.");
    }

    const href = await projectLink.getAttribute("href");
    const projectId = href?.match(/\/projects\/([^/]+)/)?.[1];
    if (!projectId) {
      test.skip(true, "Could not infer the seeded test project id.");
    }

    await page.goto(`/projects/${projectId}/settings/language-model`);
    await page.getByTestId("translation-provider-select").selectOption("mock");
    await page.getByRole("button", { name: "Save settings" }).click();

    await expect(page.getByText("Language model settings saved.")).toBeVisible();
    await expect(page.getByTestId("translation-runtime-provider")).toContainText(
      "Mock"
    );
  });
});
