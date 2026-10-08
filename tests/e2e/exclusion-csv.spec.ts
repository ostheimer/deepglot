import { expect, test } from "@playwright/test";

import { db } from "../../src/lib/db";
import { e2eId, signInAndGetProjectId } from "./helpers";

test("previews, imports, exports and repeats exclusion CSV without changing existing rules", async ({ page }) => {
  const projectId = await signInAndGetProjectId(page);
  const value = `/${e2eId("csv-exclusion")}`;
  const csv = `type,value\r\nURL,${value}\r\n`;
  try {
    await page.goto(`/projects/${projectId}/translations/import-export`);
    const card = page.locator("section").filter({ has: page.getByRole("heading", { name: "Exclusion rules CSV" }) });
    await card.getByLabel("Choose exclusion CSV").setInputFiles({
      name: "invalid.csv", mimeType: "text/csv", buffer: Buffer.from(`type,value\nURL,${value}\nCSS_CLASS,`),
    });
    await card.getByRole("button", { name: "Preview import" }).click();
    await expect(card.getByRole("status")).toContainText("1 new, 0 existing, 1 conflicts");
    await expect(card.getByRole("status")).toContainText("Row 3: Invalid exclusion type or empty value");
    await expect(card.getByRole("button", { name: "Import rules" })).toBeDisabled();
    expect(await db.translationExclusion.count({ where: { projectId, type: "URL", value } })).toBe(0);

    const duplicateResponse = await page.request.post(`/api/projects/${projectId}/exclusions/import`, {
      multipart: {
        dryRun: "false",
        file: { name: "duplicate.csv", mimeType: "text/csv", buffer: Buffer.from(`type,value\nURL,${value}\nURL,${value}`) },
      },
    });
    expect(duplicateResponse.status()).toBe(400);
    expect((await duplicateResponse.json()).issues).toEqual([{ line: 3, message: "Duplicate rule in CSV" }]);
    expect(await db.translationExclusion.count({ where: { projectId, type: "URL", value } })).toBe(0);
    await card.getByLabel("Choose exclusion CSV").setInputFiles({ name: "exclusions.csv", mimeType: "text/csv", buffer: Buffer.from(csv) });
    await card.getByRole("button", { name: "Preview import" }).click();
    await expect(card.getByRole("status")).toContainText("1 new, 0 existing, 0 conflicts");
    expect(await db.translationExclusion.count({ where: { projectId, type: "URL", value } })).toBe(0);

    const [firstImport] = await Promise.all([
      page.waitForResponse((response) => response.url().endsWith(`/api/projects/${projectId}/exclusions/import`) && response.request().method() === "POST"),
      card.getByRole("button", { name: "Import rules" }).click(),
    ]);
    expect(firstImport.status()).toBe(200);
    expect((await firstImport.json()).importedRows).toBe(1);
    await expect(card.getByRole("status")).toContainText("1 new, 0 existing, 0 conflicts");
    expect(await db.translationExclusion.count({ where: { projectId, type: "URL", value } })).toBe(1);

    await card.getByRole("button", { name: "Preview import" }).click();
    await expect(card.getByRole("status")).toContainText("0 new, 1 existing, 0 conflicts");
    const [secondImport] = await Promise.all([
      page.waitForResponse((response) => response.url().endsWith(`/api/projects/${projectId}/exclusions/import`) && response.request().method() === "POST"),
      card.getByRole("button", { name: "Import rules" }).click(),
    ]);
    expect(secondImport.status()).toBe(200);
    expect((await secondImport.json()).importedRows).toBe(0);
    await expect(card.getByRole("status")).toContainText("0 new, 1 existing, 0 conflicts");
    expect(await db.translationExclusion.count({ where: { projectId, type: "URL", value } })).toBe(1);

    const [download] = await Promise.all([
      page.waitForEvent("download"),
      card.getByRole("link", { name: "Export" }).click(),
    ]);
    const stream = await download.createReadStream();
    const chunks: Buffer[] = [];
    for await (const chunk of stream) chunks.push(Buffer.from(chunk));
    expect(Buffer.concat(chunks).toString("utf8")).toContain(`URL,${value}`);
  } finally {
    await db.translationExclusion.deleteMany({ where: { projectId, type: "URL", value } });
  }
});

test("a late preview for another file cannot authorize import", async ({ page }) => {
  const projectId = await signInAndGetProjectId(page);
  let finishResponse: (() => void) | undefined;
  let markRequest: (() => void) | undefined;
  const requestSeen = new Promise<void>((resolve) => { markRequest = resolve; });
  const responseAllowed = new Promise<void>((resolve) => { finishResponse = resolve; });
  await page.route(`**/api/projects/${projectId}/exclusions/import`, async (route) => {
    markRequest?.();
    await responseAllowed;
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ dryRun: true, summary: { creates: 1, updates: 0, skips: 0, conflicts: 0 }, issues: [] }),
    });
  });
  await page.goto(`/projects/${projectId}/translations/import-export`);
  const card = page.locator("section").filter({ has: page.getByRole("heading", { name: "Exclusion rules CSV" }) });
  const input = card.getByLabel("Choose exclusion CSV");
  await input.setInputFiles({ name: "a.csv", mimeType: "text/csv", buffer: Buffer.from("type,value\nURL,/a") });
  await card.getByRole("button", { name: "Preview import" }).click();
  await requestSeen;
  await input.setInputFiles({ name: "b.csv", mimeType: "text/csv", buffer: Buffer.from("type,value\nURL,/b") });
  const oldResponsePromise = page.waitForResponse((response) => response.url().endsWith(`/api/projects/${projectId}/exclusions/import`));
  finishResponse?.();
  const oldResponse = await oldResponsePromise;
  await oldResponse.finished();
  await page.evaluate(() => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
  await expect(card.getByRole("status")).toHaveCount(0);
  await expect(card.getByRole("button", { name: "Import rules" })).toBeDisabled();
});

test("a failed write clears the successful preview before another import", async ({ page }) => {
  const projectId = await signInAndGetProjectId(page);
  let requests = 0;
  await page.route(`**/api/projects/${projectId}/exclusions/import`, async (route) => {
    requests++;
    await route.fulfill({
      status: requests === 1 ? 200 : 409,
      contentType: "application/json",
      body: requests === 1
        ? JSON.stringify({ dryRun: true, summary: { creates: 1, updates: 0, skips: 0, conflicts: 0 }, issues: [] })
        : JSON.stringify({ error: "Rules changed during import. Preview again." }),
    });
  });
  await page.goto(`/projects/${projectId}/translations/import-export`);
  const card = page.locator("section").filter({ has: page.getByRole("heading", { name: "Exclusion rules CSV" }) });
  await card.getByLabel("Choose exclusion CSV").setInputFiles({ name: "race.csv", mimeType: "text/csv", buffer: Buffer.from("type,value\nURL,/race") });
  await card.getByRole("button", { name: "Preview import" }).click();
  await expect(card.getByRole("button", { name: "Import rules" })).toBeEnabled();
  const writeResponse = page.waitForResponse((response) => response.url().endsWith(`/api/projects/${projectId}/exclusions/import`) && response.status() === 409);
  await card.getByRole("button", { name: "Import rules" }).click();
  const failedWrite = await writeResponse;
  await failedWrite.finished();
  await expect(page.getByText("Rules changed during import. Preview again.")).toBeVisible();
  await expect(card.getByRole("button", { name: "Import rules" })).toBeDisabled();
});

test("CSV controls are visible to managers and hidden from translators", async ({ page }) => {
  const projectId = await signInAndGetProjectId(page);
  const project = await db.project.findUniqueOrThrow({ where: { id: projectId }, select: { organizationId: true } });
  const owner = await db.organizationMember.findFirstOrThrow({
    where: { organizationId: project.organizationId, role: "OWNER" },
    include: { user: { select: { email: true } } },
  });
  const existingMember = await db.projectMember.findFirst({ where: { projectId, userId: owner.userId } });
  await page.goto(`/projects/${projectId}/translations/import-export`);
  await expect(page.getByRole("heading", { name: "Exclusion rules CSV" })).toBeVisible();
  try {
    await db.organizationMember.update({ where: { id: owner.id }, data: { role: "MEMBER" } });
    if (existingMember) {
      await db.projectMember.update({ where: { id: existingMember.id }, data: { role: "TRANSLATOR", langCode: "en" } });
    } else {
      await db.projectMember.create({ data: { projectId, userId: owner.userId, email: owner.user.email, role: "TRANSLATOR", langCode: "en" } });
    }
    await page.reload();
    await expect(page.getByRole("heading", { name: "Import & export" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Exclusion rules CSV" })).toHaveCount(0);
    const response = await page.request.get(`/api/projects/${projectId}/exclusions/export`);
    expect(response.status()).toBe(404);
  } finally {
    await db.organizationMember.update({ where: { id: owner.id }, data: { role: owner.role } });
    if (existingMember) {
      await db.projectMember.update({ where: { id: existingMember.id }, data: { role: existingMember.role, langCode: existingMember.langCode } });
    } else {
      await db.projectMember.deleteMany({ where: { projectId, userId: owner.userId } });
    }
  }
});
