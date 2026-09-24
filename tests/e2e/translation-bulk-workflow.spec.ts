import { expect, test } from "@playwright/test";
import { db } from "../../src/lib/db";
import { e2eId, signInAndGetProjectId } from "./helpers";

test("workspace selects visible rows and applies one atomic assignment and review action", async ({ page }) => {
  const projectId = await signInAndGetProjectId(page);
  const marker = e2eId("Bulk review");
  const member = await db.projectMember.findFirstOrThrow({
    where: { projectId, email: "translator@deepglot.local" },
  });
  const rows = await Promise.all(["one", "two"].map((key) => db.translation.create({
    data: {
      projectId, originalHash: `${marker}-${key}`, originalText: `${marker} ${key}`,
      translatedText: `Translated ${key}`, langFrom: "de", langTo: "en", source: "MOCK",
    },
  })));
  try {
    await page.goto(`/projects/${projectId}/translations/pros`);
    await page.getByPlaceholder("Search text...").fill(marker);
    await page.getByRole("button", { name: "Search", exact: true }).click();
    await expect(page.locator("article")).toHaveCount(2);
    await page.getByRole("checkbox", { name: "Select visible segments" }).check();
    await expect(page.getByText("2 selected on this page")).toBeVisible();
    await page.getByLabel("Bulk action").selectOption("assign");
    await page.getByLabel("Assign selected to a team member").selectOption(member.id);
    await page.getByRole("button", { name: "Apply to selection" }).click();
    await expect(page.getByRole("status")).toContainText("2 segments updated together.");
    await expect(page.locator("article").first()).toContainText("Assigned");
    await page.getByRole("checkbox", { name: "Select visible segments" }).check();
    await page.getByLabel("Bulk action").selectOption("submit");
    await page.getByRole("button", { name: "Apply to selection" }).click();
    await expect(page.locator("article").first()).toContainText("In review");
    await page.getByRole("checkbox", { name: "Select visible segments" }).check();
    await page.getByLabel("Bulk action").selectOption("approve");
    await page.getByRole("button", { name: "Apply to selection" }).click();
    await expect(page.locator("article").first()).toContainText("Approved");
    for (const row of rows) {
      const saved = await db.translation.findUniqueOrThrow({ where: { id: row.id } });
      expect(saved.workflowStatus).toBe("APPROVED");
      expect(saved.assignedToId).toBe(member.id);
    }
    await page.getByRole("checkbox", { name: "Select visible segments" }).check();
    await page.getByLabel("Bulk action").selectOption("reopen");
    await db.translation.update({
      where: { id: rows[1].id }, data: { translatedText: "Changed after selection" },
    });
    await page.getByRole("button", { name: "Apply to selection" }).click();
    await expect(page.getByText("The bulk action could not be confirmed. Check the refreshed list before retrying.")).toBeVisible();
    for (const row of rows) {
      expect((await db.translation.findUniqueOrThrow({ where: { id: row.id } })).workflowStatus).toBe("APPROVED");
    }
    await page.getByRole("checkbox", { name: "Select visible segments" }).uncheck();
    await page.locator("article").filter({ hasText: `${marker} one` }).getByRole("checkbox", { name: "Select segment" }).check();
    await page.getByRole("button", { name: "Apply to selection" }).click();
    await expect(page.getByRole("status")).toContainText("1 segment updated together.");
    expect((await db.translation.findUniqueOrThrow({ where: { id: rows[0].id } })).workflowStatus).toBe("ASSIGNED");
  } finally {
    await db.translation.deleteMany({ where: { id: { in: rows.map((row) => row.id) } } });
    await db.$disconnect();
  }
});

test("bulk assignment cannot submit an assignee excluded by a changed selection", async ({ page }) => {
  const projectId = await signInAndGetProjectId(page);
  const marker = e2eId("Bulk assignee scope");
  const member = await db.projectMember.findFirstOrThrow({
    where: { projectId, email: "translator@deepglot.local" },
  });
  expect(member.langCode).toBe("en");
  const rows = await Promise.all(["en", "fr"].map((langTo) => db.translation.create({
    data: {
      projectId, originalHash: `${marker}-${langTo}`, originalText: `${marker} ${langTo}`,
      translatedText: `Translated ${langTo}`, langFrom: "de", langTo, source: "MOCK",
    },
  })));
  try {
    await page.goto(`/projects/${projectId}/translations/pros`);
    await page.getByPlaceholder("Search text...").fill(marker);
    await page.getByRole("button", { name: "Search", exact: true }).click();
    await expect(page.locator("article")).toHaveCount(2);
    await page.locator("article").filter({ hasText: `${marker} en` }).getByRole("checkbox", { name: "Select segment" }).check();
    await page.getByLabel("Bulk action").selectOption("assign");
    await page.getByLabel("Assign selected to a team member").selectOption(member.id);
    await expect(page.getByRole("button", { name: "Apply to selection" })).toBeEnabled();
    await page.locator("article").filter({ hasText: `${marker} fr` }).getByRole("checkbox", { name: "Select segment" }).check();
    await expect(page.getByRole("button", { name: "Apply to selection" })).toBeDisabled();
  } finally {
    await db.translation.deleteMany({ where: { id: { in: rows.map((row) => row.id) } } });
    await db.$disconnect();
  }
});
