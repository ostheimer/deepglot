import { expect, test } from "@playwright/test";

import { signInAndGetProjectId } from "./helpers";

test.describe("project settings accessibility", () => {
  test("labels editable general settings and explains the protected source language", async ({
    page,
  }) => {
    const projectId = await signInAndGetProjectId(page);

    await page.goto(`/projects/${projectId}/settings`);

    await expect(page.getByRole("textbox", { name: "Project name" })).toBeEnabled();
    await expect(page.getByRole("textbox", { name: "Website URL" })).toBeEnabled();
    await expect(
      page.getByRole("link", { name: "Open website in a new tab" })
    ).toBeVisible();
    await expect(
      page.getByRole("combobox", { name: "Original language" })
    ).toBeDisabled();
    await expect(
      page.getByText(/cannot be changed after translations or language-dependent content exist/i)
    ).toBeVisible();
    await expect(
      page.getByRole("switch", { name: "Automatic redirect" })
    ).toBeEnabled();
    await expect(
      page.getByRole("switch", { name: "Show AI translation notice" })
    ).toBeEnabled();
    await expect(
      page.getByRole("switch", { name: "Automatic content translation" })
    ).toBeEnabled();
    await expect(
      page.getByRole("combobox", { name: "Website type" })
    ).toBeEnabled();
    await expect(
      page.getByRole("combobox", { name: "Industry" })
    ).toBeEnabled();
    await expect(
      page.getByRole("button", { name: "Save project settings" })
    ).toBeEnabled();
    await expect(
      page.getByRole("switch", { name: "Translation memory" })
    ).toBeDisabled();
  });

  test("persists general settings, refreshes navigation and rejects a stale revision", async ({
    page,
  }) => {
    const projectId = await signInAndGetProjectId(page);
    const initialResponse = await page.request.get(`/api/projects/${projectId}`);
    expect(initialResponse.ok()).toBeTruthy();
    const initial = (await initialResponse.json()) as {
      version: string;
      name: string;
      domain: string;
      sourceLanguage: string;
      autoRedirect: boolean;
      displayAiNotice: boolean;
      automaticTranslation: boolean;
      websiteType: string | null;
      industryType: string | null;
    };
    const externalName = `External settings ${Date.now()}`;
    const updatedName = `Editable settings ${Date.now()}`;
    const nextWebsiteType = initial.websiteType === "Blog" ? "Other" : "Blog";
    const nextIndustryType =
      initial.industryType === "Education" ? "Other" : "Education";

    try {
      await page.goto(`/projects/${projectId}/settings`);

      const externalResponse = await page.request.patch(
        `/api/projects/${projectId}`,
        {
          data: {
            expectedVersion: initial.version,
            name: externalName,
          },
        },
      );
      expect(externalResponse.status()).toBe(200);

      await page.getByRole("textbox", { name: "Project name" }).fill(updatedName);
      await page.getByRole("button", { name: "Save project settings" }).click();

      await expect(
        page
          .getByRole("alert")
          .filter({ hasText: "These settings changed elsewhere." }),
      ).toBeVisible();
      const reloadButton = page.getByRole("button", {
        name: "Reload current settings",
      });
      await expect(reloadButton).toBeVisible();
      await reloadButton.click();
      await expect(page.getByRole("textbox", { name: "Project name" })).toHaveValue(
        externalName,
      );
      await expect(page.getByRole("status")).toHaveText(
        "Current project settings loaded.",
      );

      await page.getByRole("textbox", { name: "Project name" }).fill(updatedName);

      for (const [name, value] of [
        ["Automatic redirect", !initial.autoRedirect],
        ["Show AI translation notice", !initial.displayAiNotice],
        ["Automatic content translation", !initial.automaticTranslation],
      ] as const) {
        const control = page.getByRole("switch", { name });
        if ((await control.getAttribute("aria-checked")) !== String(value)) {
          await control.click();
        }
      }

      await page
        .getByRole("combobox", { name: "Website type" })
        .selectOption(nextWebsiteType);
      await page
        .getByRole("combobox", { name: "Industry" })
        .selectOption(nextIndustryType);
      await page.getByRole("button", { name: "Save project settings" }).click();

      await expect(page.getByRole("status")).toHaveText("Project settings saved.");
      await expect(
        page.getByTestId("project-desktop-sidebar").getByText(updatedName)
      ).toBeVisible();

      await page.reload();
      await expect(page.getByRole("textbox", { name: "Project name" })).toHaveValue(
        updatedName
      );
      await expect(
        page.getByRole("combobox", { name: "Website type" })
      ).toHaveValue(nextWebsiteType);
      await expect(page.getByRole("combobox", { name: "Industry" })).toHaveValue(
        nextIndustryType
      );
    } finally {
      const currentResponse = await page.request.get(`/api/projects/${projectId}`);
      expect(currentResponse.status()).toBe(200);
      const current = (await currentResponse.json()) as { version: string };
      const restoreResponse = await page.request.patch(
        `/api/projects/${projectId}`,
        {
          data: {
            expectedVersion: current.version,
            name: initial.name,
            autoRedirect: initial.autoRedirect,
            displayAiNotice: initial.displayAiNotice,
            automaticTranslation: initial.automaticTranslation,
            websiteType: initial.websiteType,
            industryType: initial.industryType,
          },
        },
      );
      expect(restoreResponse.status()).toBe(200);
    }
  });

  test("labels read-only language switcher controls", async ({ page }) => {
    const projectId = await signInAndGetProjectId(page);

    await page.goto(`/projects/${projectId}/settings/switcher`);

    await expect(page.getByRole("combobox", { name: "Flag style" })).toBeDisabled();
    await expect(page.getByRole("textbox", { name: "Custom CSS" })).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Edit original language appearance" })
    ).toBeDisabled();
    await expect(page.getByRole("button", { name: /Edit English appearance/ })).toBeDisabled();
  });
});
