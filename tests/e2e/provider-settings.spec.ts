import { expect, test } from "@playwright/test";

import { signInAndGetProjectId } from "./helpers";

test.describe("provider settings", () => {
  test("saves the mock translation provider without real provider secrets", async ({
    page,
  }) => {
    const projectId = await signInAndGetProjectId(page);

    await page.goto(`/projects/${projectId}/settings/language-model`);
    await page.getByTestId("translation-provider-select").selectOption("mock");
    await page.getByRole("button", { name: "Save settings" }).click();

    await expect(page.getByText("Language model settings saved.")).toBeVisible();
    await expect(page.getByTestId("translation-runtime-provider")).toContainText(
      "Mock"
    );
  });
});
