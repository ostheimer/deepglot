import { expect, test } from "@playwright/test";
import bcrypt from "bcryptjs";
import { db } from "@/lib/db";
import { e2eId, signInAndGetProjectId } from "./helpers";

test.afterAll(async () => {
  await db.$disconnect();
});

test("manager edits and resets one slug while CSV and CAS stay consistent", async ({ page }) => {
  const projectId = await signInAndGetProjectId(page);
  await page.goto(`/projects/${projectId}/translations/slugs?lang=en`);
  await expect(page.getByText("preise", { exact: true })).toBeVisible();
  const row = page.locator("[data-slug-id]").filter({ hasText: "preise" }).first();
  const initialExport = await page.request.get(`/api/projects/${projectId}/export?asset=slugs&format=csv`);
  expect(initialExport.status()).toBe(200);
  const originalCsv = await initialExport.text();
  try {
    const slugId = await row.getAttribute("data-slug-id");
    const originalUpdatedAt = await row.getAttribute("data-slug-updated-at");
    expect(slugId).toBeTruthy();
    expect(originalUpdatedAt).toBeTruthy();
    const anonymous = await page.context().browser()!.newContext();
    try {
      const denied = await anonymous.request.patch(new URL(`/api/projects/${projectId}/slugs/${slugId}`, page.url()).toString(), {
        data: { translatedSlug: "unauthorized", updatedAt: originalUpdatedAt },
      });
      expect(denied.status()).toBe(401);
    } finally {
      await anonymous.close();
    }
    const reservedResponse = await page.request.patch(`/api/projects/${projectId}/slugs/${slugId}`, {
      data: { translatedSlug: "WP%2DADMIN", updatedAt: originalUpdatedAt },
    });
    expect(reservedResponse.status()).toBe(400);
    expect((await reservedResponse.json()).code).toBe("reserved_slug");
    await row.getByRole("button", { name: "Edit" }).click();
    await row.getByRole("textbox", { name: "Translated slug for preise" }).fill("  SHOP  ");
    await row.getByRole("button", { name: "Save" }).click();
    await expect(row.getByText("shop", { exact: true })).toBeVisible();

    const staleResponse = await page.request.patch(`/api/projects/${projectId}/slugs/${slugId}`, {
      data: { translatedSlug: "stale-overwrite", updatedAt: originalUpdatedAt },
    });
    expect(staleResponse.status()).toBe(409);
    expect((await staleResponse.json()).code).toBe("stale_slug");

    const exportResponse = await page.request.get(`/api/projects/${projectId}/export?asset=slugs&format=csv`);
    expect(exportResponse.status()).toBe(200);
    const editedCsv = await exportResponse.text();
    expect(editedCsv).toContain("preise,shop,en,1");

    await row.getByRole("button", { name: "Reset" }).click();
    await expect(row.getByText("No mapping", { exact: true })).toBeVisible();
    const resetExport = await page.request.get(`/api/projects/${projectId}/export?asset=slugs&format=csv`);
    expect(await resetExport.text()).toContain("preise,,en,1");

    const reimport = await page.request.post(`/api/projects/${projectId}/import`, {
      multipart: {
        asset: "slugs",
        format: "csv",
        file: { name: "slugs.csv", mimeType: "text/csv", buffer: Buffer.from(editedCsv) },
      },
    });
    expect(reimport.status()).toBe(200);
    const importedExport = await page.request.get(`/api/projects/${projectId}/export?asset=slugs&format=csv`);
    expect(await importedExport.text()).toContain("preise,shop,en,1");

    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(`/projects/${projectId}/translations/slugs?lang=en`);
    const hasHorizontalOverflow = await page.evaluate(() =>
      document.documentElement.scrollWidth > window.innerWidth + 1,
    );
    expect(hasHorizontalOverflow).toBe(false);
    const card = page.locator("div.rounded-xl.overflow-hidden").filter({ hasText: "ORIGINAL SLUG" }).first();
    const mobileRow = page.locator("[data-slug-id]").filter({ hasText: "preise" }).first();
    await mobileRow.getByRole("button", { name: "Edit" }).click();
    const cardBox = await card.boundingBox();
    expect(cardBox).toBeTruthy();
    for (const control of [
      mobileRow.getByRole("textbox", { name: "Translated slug for preise" }),
      mobileRow.getByRole("button", { name: "Save" }),
      mobileRow.getByRole("button", { name: "Cancel" }),
    ]) {
      const box = await control.boundingBox();
      expect(box).toBeTruthy();
      expect(box!.x).toBeGreaterThanOrEqual(cardBox!.x - 1);
      expect(box!.x + box!.width).toBeLessThanOrEqual(cardBox!.x + cardBox!.width + 1);
      expect(box!.y).toBeGreaterThanOrEqual(cardBox!.y - 1);
      expect(box!.y + box!.height).toBeLessThanOrEqual(cardBox!.y + cardBox!.height + 1);
    }
  } finally {
    const restore = await page.request.post(`/api/projects/${projectId}/import`, {
      multipart: {
        asset: "slugs",
        format: "csv",
        file: { name: "slugs.csv", mimeType: "text/csv", buffer: Buffer.from(originalCsv) },
      },
    });
    expect(restore.status()).toBe(200);
  }
});


test("language-bound translator reads only their slug language and cannot edit", async ({ page }) => {
  const projectId = await signInAndGetProjectId(page);
  const email = `${e2eId("slug-translator")}@example.test`;
  const password = e2eId("password");
  const user = await db.user.create({ data: {
    email,
    password: await bcrypt.hash(password, 10),
  } });
  const member = await db.projectMember.create({ data: {
    projectId, userId: user.id, email, role: "TRANSLATOR", langCode: "fr",
  } });
  const slug = await db.urlSlug.create({ data: {
    projectId, originalSlug: e2eId("slug-fr"), translatedSlug: "chemin-fr", langTo: "fr",
  } });
  try {
    await page.context().clearCookies();
    await page.goto("/login");
    await page.getByLabel("Email").fill(email);
    await page.getByLabel("Password").fill(password);
    await page.getByRole("button", { name: "Sign in", exact: true }).click();
    await page.waitForURL(/\/dashboard$/);

    await page.goto(`/projects/${projectId}/translations/slugs?lang=fr`);
    await expect(page.getByText(slug.originalSlug, { exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "Edit" })).toHaveCount(0);
    const forbiddenLanguage = await page.goto(`/projects/${projectId}/translations/slugs?lang=en`);
    expect(forbiddenLanguage?.status()).toBe(404);

    const deniedWrite = await page.request.patch(`/api/projects/${projectId}/slugs/${slug.id}`, {
      data: { translatedSlug: "pas-autorise", updatedAt: slug.updatedAt.toISOString() },
    });
    expect(deniedWrite.status()).toBe(404);
    const deniedBulk = await page.request.post(`/api/projects/${projectId}/slugs/bulk`, {
      data: { action: "reset", rows: [{ id: slug.id, updatedAt: slug.updatedAt.toISOString() }] },
    });
    expect(deniedBulk.status()).toBe(404);
    const deniedImport = await page.request.post(`/api/projects/${projectId}/import`, {
      multipart: { asset: "slugs", format: "csv", file: { name: "slugs.csv", mimeType: "text/csv", buffer: Buffer.from(`originalSlug,translatedSlug,langTo,urlCount\n${slug.originalSlug},new-target,fr,0\n`) } },
    });
    expect(deniedImport.status()).toBe(403);
    const unchanged = await db.urlSlug.findUniqueOrThrow({ where: { id: slug.id } });
    expect(unchanged.translatedSlug).toBe("chemin-fr");
  } finally {
    await db.urlSlug.delete({ where: { id: slug.id } });
    await db.projectMember.delete({ where: { id: member.id } });
    await db.user.delete({ where: { id: user.id } });
  }
});

test("searches both columns, filters status, and resets a selected page atomically", async ({ page }) => {
  const projectId = await signInAndGetProjectId(page);
  const marker = e2eId("bulk-slug");
  const rows = await Promise.all([
    db.urlSlug.create({ data: { projectId, originalSlug: `${marker}-a`, translatedSlug: `${marker}-target`, langTo: "en" } }),
    db.urlSlug.create({ data: { projectId, originalSlug: `${marker}-b`, translatedSlug: null, langTo: "en" } }),
  ]);
  try {
    await page.goto(`/projects/${projectId}/translations/slugs?lang=en&q=${marker}-target&status=translated`);
    await expect(page.getByText(`${marker}-a`, { exact: true })).toBeVisible();
    await expect(page.getByText(`${marker}-b`, { exact: true })).toHaveCount(0);
    await page.goto(`/projects/${projectId}/translations/slugs?lang=en&q=${marker}&status=translated`);
    await page.getByRole("checkbox", { name: `Select ${marker}-a` }).check();
    await page.getByRole("link", { name: "Untranslated" }).click();
    await expect(page.getByText(`${marker}-b`, { exact: true })).toBeVisible();
    await expect(page.getByText("0 selected on this page")).toBeVisible();
    await expect(page.getByRole("button", { name: "Export selected" })).toBeDisabled();
    await page.getByRole("link", { name: "Translated", exact: true }).click();
    await page.getByRole("checkbox", { name: `Select ${marker}-a` }).check();

    const stale = await page.request.post(`/api/projects/${projectId}/slugs/bulk`, {
      data: { action: "reset", rows: [
        { id: rows[0].id, updatedAt: rows[0].updatedAt.toISOString() },
        { id: rows[1].id, updatedAt: "2000-01-01T00:00:00.000Z" },
      ] },
    });
    expect(stale.status()).toBe(409);
    expect((await db.urlSlug.findUniqueOrThrow({ where: { id: rows[0].id } })).translatedSlug).toBe(`${marker}-target`);

    await page.getByRole("button", { name: "Reset selected" }).click();
    await expect(page.getByText(`${marker}-a`, { exact: true })).toHaveCount(0);
    await page.goto(`/projects/${projectId}/translations/slugs?lang=en&q=${marker}&status=untranslated`);
    await expect(page.getByText(`${marker}-a`, { exact: true })).toBeVisible();
    await expect(page.getByText(`${marker}-b`, { exact: true })).toBeVisible();
    const persisted = await db.urlSlug.findUniqueOrThrow({ where: { id: rows[0].id } });
    expect(persisted.translatedSlug).toBeNull();
  } finally {
    await db.urlSlug.deleteMany({ where: { id: { in: rows.map((row) => row.id) } } });
  }
});

test("CSV reports a conflicting line without writing earlier rows", async ({ page }) => {
  const projectId = await signInAndGetProjectId(page);
  const marker = e2eId("csv-slug");
  const response = await page.request.post(`/api/projects/${projectId}/import`, {
    multipart: { asset: "slugs", format: "csv", file: {
      name: "slugs.csv", mimeType: "text/csv",
      buffer: Buffer.from(`originalSlug,translatedSlug,langTo,urlCount\n${marker}-safe,${marker}-target,en,1\n${marker}-bad,wp-admin,en,1\n`),
    } },
  });
  expect(response.status()).toBe(409);
  expect((await response.json()).error).toMatch(/Line 3:.*wp-admin/);
  expect(await db.urlSlug.count({ where: { projectId, originalSlug: { startsWith: marker } } })).toBe(0);
});

test("CSV applies a valid mapping move across the former chunk boundary", async ({ page }) => {
  const projectId = await signInAndGetProjectId(page);
  const marker = e2eId("csv-move");
  const existing = await db.urlSlug.create({ data: {
    projectId, originalSlug: `${marker}-late`, translatedSlug: `${marker}-old`, langTo: "en",
  } });
  const createdSources = Array.from({ length: 100 }, (_, index) => `${marker}-${index}`);
  const csv = ["originalSlug,translatedSlug,langTo,urlCount",
    `${createdSources[0]},${marker}-old,en,1`,
    ...createdSources.slice(1).map((source, index) => `${source},${marker}-target-${index},en,1`),
    `${marker}-late,${marker}-new,en,1`,
  ].join("\n") + "\n";
  try {
    const response = await page.request.post(`/api/projects/${projectId}/import`, {
      multipart: { asset: "slugs", format: "csv", file: { name: "slugs.csv", mimeType: "text/csv", buffer: Buffer.from(csv) } },
    });
    expect(response.status()).toBe(200);
    const persisted = await db.urlSlug.findMany({ where: { projectId, originalSlug: { startsWith: marker } } });
    expect(persisted).toHaveLength(101);
    expect(persisted.find((row) => row.id === existing.id)?.translatedSlug).toBe(`${marker}-new`);
    expect(persisted.find((row) => row.originalSlug === createdSources[0])?.translatedSlug).toBe(`${marker}-old`);
  } finally {
    await db.urlSlug.deleteMany({ where: { projectId, originalSlug: { startsWith: marker } } });
  }
});

test("concurrent edits of different rows cannot claim the same translated slug", async ({ page }) => {
  const projectId = await signInAndGetProjectId(page);
  const originals = [e2eId("slug-race-a"), e2eId("slug-race-b")];
  const rows = await Promise.all(originals.map((originalSlug) => db.urlSlug.create({ data: {
    projectId, originalSlug, translatedSlug: null, langTo: "en",
  } })));
  const target = e2eId("same-target");
  try {
    const responses = await Promise.all(rows.map((row) => page.request.patch(
      `/api/projects/${projectId}/slugs/${row.id}`,
      { data: { translatedSlug: target, updatedAt: row.updatedAt.toISOString() } },
    )));
    expect(responses.map((response) => response.status()).sort()).toEqual([200, 409]);
    const persisted = await db.urlSlug.findMany({ where: { id: { in: rows.map((row) => row.id) } } });
    expect(persisted.filter((row) => row.translatedSlug === target)).toHaveLength(1);
  } finally {
    await db.urlSlug.deleteMany({ where: { id: { in: rows.map((row) => row.id) } } });
  }
});
