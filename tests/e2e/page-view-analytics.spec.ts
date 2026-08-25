import { expect, test } from "@playwright/test";

import { signInAndGetProjectId } from "./helpers";

test("page views remain independent of translation-request counters and respect their selected time range", async ({
  page,
}) => {
  const projectId = await signInAndGetProjectId(page);

  await page.goto(`/projects/${projectId}/stats/page-views`);
  await expect(page.getByRole("heading", { name: "Page views" })).toBeVisible();

  const totalViews = page.getByText("Total views", { exact: true }).locator("..");
  await expect(totalViews).toContainText("5");
  await expect(totalViews).not.toContainText("36");

  const englishPricing = page.getByText("/en/preise", { exact: true }).locator("../..");
  await expect(englishPricing).toContainText("3");

  const frenchServices = page
    .getByText("/fr/leistungen", { exact: true })
    .locator("../..");
  await expect(frenchServices).toContainText("1");

  await page.getByRole("combobox").selectOption("90");
  await expect(page).toHaveURL(/zeitraum=90/);
  await expect(totalViews).toContainText("6");
  await expect(frenchServices).toContainText("2");

  await page.goto(`/projects/${projectId}/stats/requests`);
  const historicalTranslationRequests = page
    .getByText(/^https:\/\/.*\/preise$/)
    .locator("..");
  await expect(historicalTranslationRequests).toContainText("18");
});

test("project managers can revoke and explicitly renew informed page-view consent", async ({
  page,
}) => {
  const projectId = await signInAndGetProjectId(page);

  await page.goto(`/projects/${projectId}/stats/page-views`);

  try {
    await page.getByRole("button", { name: "Disable tracking" }).click();

    await expect(
      page.getByRole("heading", { name: "Page views are not enabled yet." }),
    ).toBeVisible();
    await expect(
      page.getByText("Disabled by default; collection starts only after explicit approval by a project administrator."),
    ).toBeVisible();
    await expect(
      page.getByText("Events are automatically deleted after 90 days; obvious bots and duplicate reports are excluded."),
    ).toBeVisible();

    await page.getByRole("button", { name: "Enable", exact: true }).click();
    await expect(
      page.getByRole("button", { name: "Disable tracking" }),
    ).toBeVisible();
    await expect(
      page.getByText("Total views", { exact: true }).locator(".."),
    ).toContainText("5");
  } finally {
    const restoreResponse = await page.request.post(
      `/api/projects/${projectId}/page-views/activate`,
    );
    expect(restoreResponse.status()).toBe(200);
  }
});
