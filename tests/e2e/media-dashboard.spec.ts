import { expect, test, type Page } from "@playwright/test";
import { db } from "../../src/lib/db";
import { e2eId, signInAndGetProjectId } from "./helpers";

async function createMediaTestProject(page: Page, prefix: string) {
  const seededProjectId = await signInAndGetProjectId(page);
  const seededProject = await db.project.findUniqueOrThrow({
    where: { id: seededProjectId },
    select: { organizationId: true },
  });
  return db.project.create({
    data: {
      name: prefix,
      domain: `${prefix}.example.test`,
      originalLang: "de",
      organizationId: seededProject.organizationId,
      languages: {
        create: [
          { langCode: "en", isActive: true },
          { langCode: "fr", isActive: true },
        ],
      },
    },
  });
}

test("media dashboard CRUD, scoped filters, invalid URLs, German copy and mobile layout", async ({
  page,
}) => {
  const prefix = e2eId("dashboard-media");
  const { id: projectId } = await createMediaTestProject(page, prefix);
  const url = `/uploads/${prefix}.pdf`;
  const collection = `/api/projects/${projectId}/media`;
  const created: string[] = [];
  try {
    const navigation = page.getByTestId("project-desktop-sidebar");
    await page.goto(`/projects/${projectId}/settings`);
    await expect(
      navigation.getByRole("link", { name: "General", exact: true }),
    ).toHaveAttribute("aria-current", "page");
    await page.goto(`/projects/${projectId}/settings/language-model`);
    await expect(
      navigation.getByRole("link", { name: "General", exact: true }),
    ).not.toHaveAttribute("aria-current", "page");
    await expect(
      navigation.getByRole("link", { name: "Language Model New", exact: true }),
    ).toHaveAttribute("aria-current", "page");
    await page.goto(`/projects/${projectId}/translations/media`);
    await expect(
      page.getByRole("heading", { name: "Media", exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole("link", { name: "Media", exact: true }),
    ).toHaveAttribute("aria-current", "page");
    await page
      .getByRole("button", { name: "Add mapping", exact: true })
      .click();
    const dialog = page.getByRole("dialog");
    await dialog.getByLabel("Original URL", { exact: true }).fill(url);
    await dialog
      .getByLabel("Replacement URL", { exact: true })
      .fill("https://foreign.example.test/file.pdf");
    await dialog.getByRole("button", { name: "Save", exact: true }).click();
    await expect(dialog.getByRole("alert")).toContainText(
      "supported same-site",
    );
    await dialog
      .getByLabel("Replacement URL", { exact: true })
      .fill(`/uploads/${prefix}-en.pdf`);
    const createdResponse = page.waitForResponse(
      (response) =>
        response.url().endsWith(collection) &&
        response.request().method() === "POST" &&
        response.status() === 201,
    );
    await dialog.getByRole("button", { name: "Save", exact: true }).click();
    created.push((await (await createdResponse).json()).mediaReplacement.id);
    await expect(dialog).not.toBeVisible();
    await page.getByLabel("Search URLs").fill(prefix);
    let row = page.getByTestId("media-mapping").filter({ hasText: url });
    await expect(row).toContainText(`${prefix}-en.pdf`);
    await row.getByRole("button", { name: "Edit", exact: true }).click();
    await dialog.getByLabel("Target language").selectOption("fr");
    await dialog
      .getByLabel("Replacement URL", { exact: true })
      .fill(`/uploads/${prefix}-fr.pdf`);
    await dialog.getByRole("button", { name: "Save", exact: true }).click();
    await expect(dialog).not.toBeVisible();
    await page
      .getByLabel("Target language", { exact: true })
      .selectOption("en");
    await expect(page.getByTestId("media-mapping")).toHaveCount(0);
    await page
      .getByLabel("Target language", { exact: true })
      .selectOption("fr");
    await page.getByLabel("Media type").selectOption("video");
    await expect(page.getByTestId("media-mapping")).toHaveCount(0);
    await page.getByLabel("Media type").selectOption("document");
    await expect(row).toBeVisible();
    await page.reload();
    await page.getByLabel("Search URLs").fill(prefix);
    await expect(row).toContainText(`${prefix}-fr.pdf`);
    await page.setViewportSize({ width: 390, height: 844 });
    await expect(row).toBeVisible();
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
    ).toBe(true);
    await page.screenshot({
      path: "output/playwright/media-dashboard-mobile.png",
      fullPage: true,
    });
    await page.goto(`/de/projekte/${projectId}/uebersetzungen/medien`);
    await page.getByLabel("URLs durchsuchen").fill(prefix);
    row = page.getByTestId("media-mapping").filter({ hasText: url });
    await row.getByRole("button", { name: "Bearbeiten", exact: true }).click();
    await expect(page.getByRole("dialog")).toBeVisible();
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
    ).toBe(true);
    await page.getByRole("button", { name: "Abbrechen", exact: true }).click();
    await row.getByRole("button", { name: "Löschen", exact: true }).click();
    await page
      .getByRole("dialog")
      .getByRole("button", { name: "Abbrechen" })
      .click();
    await expect(row).toBeVisible();
    await row.getByRole("button", { name: "Löschen", exact: true }).click();
    await page
      .getByRole("dialog")
      .getByRole("button", { name: "Löschen", exact: true })
      .click();
    await expect(row).toHaveCount(0);
    const response = await page.request.get(collection);
    expect(
      (await response.json()).mediaReplacements.some((item: { id: string }) =>
        created.includes(item.id),
      ),
    ).toBe(false);
  } finally {
    await db.project.delete({ where: { id: projectId } });
  }
});

test("dashboard and every media API action reject foreign tenants and translators", async ({
  page,
  request,
}) => {
  const projectId = await signInAndGetProjectId(page);
  const suffix = e2eId("media-access");
  const session = await page.request.get("/api/auth/session");
  const userId = (await session.json()).user.id as string;
  const org = await db.organization.create({
    data: { name: suffix, slug: suffix },
  });
  const project = await db.project.create({
    data: {
      name: suffix,
      domain: `${suffix}.example.test`,
      originalLang: "de",
      organizationId: org.id,
      languages: { create: { langCode: "en" } },
    },
  });
  const mapping = await db.projectMediaReplacement.create({
    data: {
      projectId: project.id,
      langTo: "en",
      originalUrl: "/uploads/private.jpg",
      localizedUrl: "/uploads/private-en.jpg",
    },
  });
  const collection = `/api/projects/${project.id}/media`;
  const payload = {
    langTo: "en",
    originalUrl: "/uploads/new.jpg",
    localizedUrl: "/uploads/new-en.jpg",
  };
  async function denied() {
    expect((await page.request.get(collection)).status()).toBe(404);
    expect(
      (await page.request.post(collection, { data: payload })).status(),
    ).toBe(404);
    expect(
      (
        await page.request.patch(`${collection}/${mapping.id}`, {
          data: payload,
        })
      ).status(),
    ).toBe(404);
    expect(
      (await page.request.delete(`${collection}/${mapping.id}`)).status(),
    ).toBe(404);
    await page.goto(`/projects/${project.id}/translations/media`);
    await expect(
      page.getByRole("heading", { name: "Media", exact: true }),
    ).toHaveCount(0);
    await expect(
      page.getByText("/uploads/private.jpg", { exact: true }),
    ).toHaveCount(0);
  }
  try {
    expect((await request.get(collection)).status()).toBe(401);
    await denied();
    await db.projectMember.create({
      data: {
        projectId: project.id,
        userId,
        email: `${suffix}@example.test`,
        role: "TRANSLATOR",
        langCode: "en",
      },
    });
    await denied();
    await page.goto(`/projects/${project.id}/translations/languages`);
    await expect(
      page.getByRole("link", { name: "Media", exact: true }),
    ).toHaveCount(0);
    await db.projectMember.updateMany({
      where: { projectId: project.id, userId },
      data: { role: "ADMIN" },
    });
    await page.goto(`/projects/${project.id}/translations/media`);
    await expect(
      page.getByText("/uploads/private.jpg", { exact: true }),
    ).toBeVisible();
    // A manager of this project cannot mutate a mapping under another project's URL.
    expect(
      (
        await page.request.patch(
          `/api/projects/${projectId}/media/${mapping.id}`,
          { data: payload },
        )
      ).status(),
    ).toBe(404);
    expect(
      (
        await page.request.delete(
          `/api/projects/${projectId}/media/${mapping.id}`,
        )
      ).status(),
    ).toBe(404);
  } finally {
    await db.organization.delete({ where: { id: org.id } });
  }
});

test("media list and save errors remain recoverable without losing entered URLs", async ({
  page,
}) => {
  const projectId = await signInAndGetProjectId(page);
  const endpoint = `/api/projects/${projectId}/media`;
  let failLoad = true;
  await page.route(`**${endpoint}`, async (route) => {
    if (route.request().method() === "GET" && failLoad)
      return route.fulfill({ status: 503, json: {} });
    if (route.request().method() === "POST") return route.abort("failed");
    return route.continue();
  });
  await page.goto(`/projects/${projectId}/translations/media`);
  await expect(
    page.getByRole("alert").filter({ hasText: "Could not load mappings" }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Add mapping", exact: true }),
  ).toBeDisabled();
  failLoad = false;
  await page.getByRole("button", { name: "Retry", exact: true }).click();
  await page.getByRole("button", { name: "Add mapping", exact: true }).click();
  const dialog = page.getByRole("dialog");
  await dialog
    .getByLabel("Original URL", { exact: true })
    .fill("/uploads/retry.jpg");
  await dialog
    .getByLabel("Replacement URL", { exact: true })
    .fill("/uploads/retry-en.jpg");
  await dialog.getByRole("button", { name: "Save", exact: true }).click();
  await expect(dialog.getByRole("alert")).toContainText(
    "Check your connection",
  );
  await expect(dialog.getByLabel("Original URL", { exact: true })).toHaveValue(
    "/uploads/retry.jpg",
  );
  await expect(
    dialog.getByRole("button", { name: "Save", exact: true }),
  ).toBeEnabled();
});

test("editing one mapping field preserves another manager's concurrent changes", async ({
  page,
}) => {
  const prefix = e2eId("media-concurrent");
  const { id: projectId } = await createMediaTestProject(page, prefix);
  const endpoint = `/api/projects/${projectId}/media`;
  try {
    const response = await page.request.post(endpoint, {
      data: {
        langTo: "en",
        originalUrl: `/uploads/${prefix}.pdf`,
        localizedUrl: `/uploads/${prefix}-en.pdf`,
      },
    });
    expect(response.status()).toBe(201);
    const { mediaReplacement } = await response.json();
    await page.goto(`/projects/${projectId}/translations/media`);
    await page.getByLabel("Search URLs").fill(prefix);
    await page
      .getByTestId("media-mapping")
      .getByRole("button", { name: "Edit", exact: true })
      .click();
    const dialog = page.getByRole("dialog");
    await dialog.getByLabel("Target language").selectOption("fr");
    const concurrentUrl = `/uploads/${prefix}-new-fr.pdf`;
    expect(
      (
        await page.request.patch(`${endpoint}/${mediaReplacement.id}`, {
          data: { localizedUrl: concurrentUrl },
        })
      ).status(),
    ).toBe(200);
    await dialog.getByRole("button", { name: "Save", exact: true }).click();
    await expect(dialog).not.toBeVisible();
    await expect(page.getByTestId("media-mapping")).toContainText(
      concurrentUrl,
    );
    await page.reload();
    await page.getByLabel("Search URLs").fill(prefix);
    await expect(page.getByTestId("media-mapping")).toContainText(
      "French (FR)",
    );
    await expect(page.getByTestId("media-mapping")).toContainText(
      concurrentUrl,
    );
  } finally {
    await db.project.delete({ where: { id: projectId } });
  }
});
