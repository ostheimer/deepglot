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

  test("preserves a Gemini model on unchanged and edited saves", async ({ page }) => {
    const projectId = await signInAndGetProjectId(page);
    const settingsUrl = `/api/projects/${projectId}/language-model`;
    const initialModel = "gemini-3.1-flash-lite";
    const original = await page.request.get(settingsUrl);
    expect(original.ok()).toBeTruthy();
    const { settings } = await original.json();

    try {
      const seeded = await page.request.patch(settingsUrl, {
        data: { provider: "gemini", model: initialModel, apiKeyAction: "keep" },
      });
      expect(seeded.ok()).toBeTruthy();
      await page.goto(`/projects/${projectId}/settings/language-model`);

      const unchangedSave = page.waitForRequest(
        (request) => request.url().endsWith(settingsUrl) && request.method() === "PATCH"
      );
      await page.getByRole("button", { name: "Save settings" }).click();
      expect((await unchangedSave).postDataJSON()).toMatchObject({
        provider: "gemini",
        model: initialModel,
        apiKeyAction: "keep",
      });
      await expect(page.getByText("Language model settings saved.")).toBeVisible();

      await page.reload();
      const model = page.getByLabel("Model", { exact: true });
      await expect(model).toHaveValue(initialModel);
      await model.fill("gemini-custom-model");
      await model.press("Enter");
      await expect(page.getByText("Language model settings saved.")).toBeVisible();
      await page.reload();
      await expect(model).toHaveValue("gemini-custom-model");
      await expect(page.getByTestId("translation-runtime-provider")).toContainText(
        "Google Gemini · gemini-custom-model"
      );
    } finally {
      const restored = await page.request.patch(settingsUrl, {
        data: { ...settings, apiKeyAction: "keep" },
      });
      expect(restored.ok()).toBeTruthy();
    }
  });
});
