import { expect, test } from "@playwright/test";

import { signInAndGetProjectId } from "./helpers";

test.describe("provider settings", () => {
  test("rejects anonymous description suggestions", async ({ request }) => {
    const response = await request.post("/api/projects/unknown/language-model");
    expect(response.status()).toBe(401);
  });

  test("suggests only on click, then persists context and switches on explicit save", async ({ page }) => {
    const projectId = await signInAndGetProjectId(page);
    const settingsUrl = `/api/projects/${projectId}/language-model`;
    const originalResponse = await page.request.get(settingsUrl);
    expect(originalResponse.ok()).toBeTruthy();
    const { settings: original } = await originalResponse.json();
    try {
      const partial = await page.request.patch(settingsUrl, { data: { translationTone: "temporary" } });
      expect(partial.ok()).toBeTruthy();
      expect((await partial.json()).settings).toMatchObject({ provider: original.provider, model: original.model });
      await page.goto(`/projects/${projectId}/settings/language-model`);
      await expect(page.getByLabel("Website description")).toHaveValue(original.websiteDescription ?? "");
      await page.getByRole("button", { name: "Suggest from project details" }).click();
      await expect(page.getByLabel("Website description")).not.toHaveValue("");
      const afterSuggestion = await page.request.get(settingsUrl);
      expect((await afterSuggestion.json()).settings.websiteDescription).toBe(original.websiteDescription);

      await page.getByLabel("Tone").fill("calm");
      await page.getByLabel("Audience").fill("new visitors");
      await page.getByLabel("Additional instructions").fill("Use short sentences.");
      await page.getByLabel("Use glossary rules as model context").check();
      await page.getByLabel("Use approved and manual translations as model context").check();
      await page.getByRole("button", { name: "Save settings" }).click();
      await expect(page.getByText("Language model settings saved.")).toBeVisible();
      const saved = await page.request.get(settingsUrl);
      expect((await saved.json()).settings).toMatchObject({
        translationTone: "calm",
        translationAudience: "new visitors",
        translationInstructions: "Use short sentences.",
        useGlossaryAsContext: true,
        useApprovedTranslationsAsContext: true,
      });
      await page.reload();
      await expect(page.getByLabel("Tone")).toHaveValue("calm");
      await expect(page.getByLabel("Use glossary rules as model context")).toBeChecked();
      await page.goto(`/de/projekte/${projectId}/einstellungen/sprachmodell`);
      await expect(page.getByLabel("Websitebeschreibung")).not.toHaveValue("");
      await expect(page.getByLabel("Tonalität")).toHaveValue("calm");
    } finally {
      const restored = await page.request.patch(settingsUrl, { data: { ...original, apiKeyAction: "keep" } });
      expect(restored.ok()).toBeTruthy();
    }
  });

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
      await page.getByTestId("translation-provider-select").selectOption("gemini");

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

  test("clears the previous provider model when switching to Gemini", async ({ page }) => {
    const projectId = await signInAndGetProjectId(page);
    const settingsUrl = `/api/projects/${projectId}/language-model`;
    const original = await page.request.get(settingsUrl);
    expect(original.ok()).toBeTruthy();
    const { settings } = await original.json();

    try {
      const seeded = await page.request.patch(settingsUrl, {
        data: { provider: "openai", model: "gpt-5-mini", apiKeyAction: "keep" },
      });
      expect(seeded.ok()).toBeTruthy();
      await page.goto(`/projects/${projectId}/settings/language-model`);
      await expect(page.getByLabel("Model", { exact: true })).toHaveValue("gpt-5-mini");

      await page.getByTestId("translation-provider-select").selectOption("gemini");
      await expect(page.getByLabel("Model", { exact: true })).toHaveValue("");
      await page.getByRole("button", { name: "Save settings" }).click();
      await expect(page.getByText("Language model settings saved.")).toBeVisible();
      const saved = await page.request.get(settingsUrl);
      expect(saved.ok()).toBeTruthy();
      const result = await saved.json();
      expect(result.settings).toMatchObject({ provider: "gemini", model: null });
      expect(result.effective.model).toMatch(/^gemini-/);
    } finally {
      const restored = await page.request.patch(settingsUrl, {
        data: { ...settings, apiKeyAction: "keep" },
      });
      expect(restored.ok()).toBeTruthy();
    }
  });
});
