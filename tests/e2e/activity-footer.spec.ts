import { expect, test } from "@playwright/test";
import { signInAsTestUser } from "./helpers";

test("activity export and overview links have visible spacing", async ({ page }) => {
  await signInAsTestUser(page);
  await page.goto("/de/dashboard/aktivitaet");

  const exportLink = page.getByRole("link", { name: "Angezeigte Ereignisse als CSV exportieren" });
  const overviewLink = page.getByRole("link", { name: "Zur Übersicht" });
  const exportBox = await exportLink.boundingBox();
  const overviewBox = await overviewLink.boundingBox();
  expect(exportBox).not.toBeNull();
  expect(overviewBox).not.toBeNull();
  expect(overviewBox!.x - (exportBox!.x + exportBox!.width)).toBeGreaterThanOrEqual(8);
});
