import { expect, test } from "@playwright/test";

import { signInAndGetProjectId } from "./helpers";

test.describe("project settings accessibility", () => {
  test("labels read-only settings controls and mirrored runtime switches", async ({
    page,
  }) => {
    const projectId = await signInAndGetProjectId(page);

    await page.goto(`/projects/${projectId}/settings`);

    await expect(page.getByRole("textbox", { name: "Project name" })).toBeVisible();
    await expect(page.getByRole("textbox", { name: "Website URL" })).toBeVisible();
    await expect(
      page.getByRole("link", { name: "Open website in a new tab" })
    ).toBeVisible();
    await expect(
      page.getByRole("switch", { name: "Automatic redirect" })
    ).toBeDisabled();
    await expect(
      page.getByRole("switch", { name: "Show AI translation notice" })
    ).toBeDisabled();
    await expect(
      page.getByRole("switch", { name: "Automatic content translation" })
    ).toBeDisabled();
    await expect(
      page.getByRole("checkbox", { name: "Translation memory (beta)" })
    ).toBeDisabled();
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
