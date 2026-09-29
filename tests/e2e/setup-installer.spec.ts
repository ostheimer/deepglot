import { expect, test } from "@playwright/test";

import { signInAndGetProjectId } from "./helpers";

test("German setup links to the published installer without mobile overflow", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const projectId = await signInAndGetProjectId(page);

  await page.goto(`/de/projects/${projectId}/settings/setup`);
  await expect(page.getByRole("heading", { name: "WordPress Plugin einrichten" })).toBeVisible();
  await expect(page.getByText("Plugin von WordPress.org herunterladen und installieren")).toBeVisible();

  const installer = page.getByRole("link", { name: "WordPress.org" });
  await expect(installer).toBeVisible();
  await expect(installer).toHaveAttribute("href", "https://wordpress.org/plugins/deepglot/");
  const box = await installer.boundingBox();
  expect(box).toBeTruthy();
  expect(box!.x + box!.width).toBeLessThanOrEqual(391);

  const documentWidth = await page.evaluate(() => document.documentElement.scrollWidth);
  expect(documentWidth).toBeLessThanOrEqual(390);
});
