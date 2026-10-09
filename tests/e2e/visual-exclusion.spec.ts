import { expect, test } from "@playwright/test";

import { db } from "../../src/lib/db";
import { signInAndGetProjectId } from "./helpers";

test("manager selects unique ID and class in a script-free page preview and saves runtime rules", async ({ page }) => {
  const projectId = await signInAndGetProjectId(page);
  const id = "fixture-visual-271-id";
  const className = "fixture-visual-271-class";
  await page.route(`**/api/projects/${projectId}/exclusions/visual-preview`, async (route) => {
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({
      url: "https://example.com/fixture-271/",
      html: `<html><body><main id="fixture-visual-271-main"><p id="${id}">Keep ID</p><p class="${className}">Keep class</p><p class="content">Generic</p><script>window.__visualFixtureExecuted = true</script></main></body></html>`,
    }) });
  });
  try {
    await page.goto(`/projects/${projectId}/settings/exclusions`);
    await page.getByRole("button", { name: "Select on page" }).click();
    await page.getByLabel("Project page path").fill("/fixture-271/");
    await page.getByRole("button", { name: "Load page" }).click();
    const frame = page.frameLocator('iframe[title="Page preview for element selection"]');
    await frame.locator(`#${id}`).click();
    await expect(page.getByText(`Generated selector: #${id}`)).toBeVisible();
    await expect(page.getByText("Matches on this page: 1")).toBeVisible();
    expect(await frame.locator("body").evaluate(() => (window as Window & { __visualFixtureExecuted?: boolean }).__visualFixtureExecuted)).toBeUndefined();
    await page.getByRole("button", { name: "Save exclusion" }).click();
    await expect(page.getByRole("dialog")).toHaveCount(0);
    expect(await db.translationExclusion.count({ where: { projectId, type: "CSS_ID", value: id } })).toBe(1);

    await page.getByRole("button", { name: "Select on page" }).click();
    await page.getByRole("button", { name: "Load page" }).click();
    await frame.locator("main").dispatchEvent("click");
    await expect(page.getByRole("button", { name: "Save exclusion" })).toBeDisabled();
    await frame.locator(".content").click();
    await expect(page.getByRole("button", { name: "Save exclusion" })).toBeDisabled();
    await frame.locator(`.${className}`).click();
    await expect(page.getByText(`Generated selector: .${className}`)).toBeVisible();
    await page.getByRole("button", { name: "Save exclusion" }).click();
    await expect(page.getByRole("dialog")).toHaveCount(0);
    expect(await db.translationExclusion.count({ where: { projectId, type: "CSS_CLASS", value: className } })).toBe(1);
  } finally {
    await db.translationExclusion.deleteMany({ where: { projectId, OR: [{ type: "CSS_ID", value: id }, { type: "CSS_CLASS", value: className }] } });
  }
});

test("visual preview rejects a translator before loading the project page", async ({ page }) => {
  const projectId = await signInAndGetProjectId(page);
  const project = await db.project.findUniqueOrThrow({ where: { id: projectId }, select: { organizationId: true } });
  const owner = await db.organizationMember.findFirstOrThrow({ where: { organizationId: project.organizationId, role: "OWNER" }, include: { user: { select: { email: true } } } });
  const membership = await db.projectMember.findFirst({ where: { projectId, userId: owner.userId } });
  try {
    await db.organizationMember.update({ where: { id: owner.id }, data: { role: "MEMBER" } });
    if (membership) {
      await db.projectMember.update({ where: { id: membership.id }, data: { role: "TRANSLATOR", langCode: "en" } });
    } else {
      await db.projectMember.create({ data: { projectId, userId: owner.userId, email: owner.user.email, role: "TRANSLATOR", langCode: "en" } });
    }
    const response = await page.request.post(`/api/projects/${projectId}/exclusions/visual-preview`, { data: { path: "/" } });
    expect(response.status()).toBe(404);
    await page.goto(`/projects/${projectId}/settings/exclusions`);
    await expect(page.getByRole("button", { name: "Select on page" })).toHaveCount(0);
  } finally {
    await db.organizationMember.update({ where: { id: owner.id }, data: { role: owner.role } });
    if (membership) {
      await db.projectMember.update({ where: { id: membership.id }, data: { role: membership.role, langCode: membership.langCode } });
    } else {
      await db.projectMember.deleteMany({ where: { projectId, userId: owner.userId } });
    }
  }
});
