import { expect, test } from "@playwright/test";
import { signInAndGetProjectId, e2eId } from "./helpers";
import { db } from "../../src/lib/db";
import { createHash } from "node:crypto";

test("navigates segment context and combines advanced filters", async ({
  page,
}) => {
  const projectId = await signInAndGetProjectId(page);
  const originalText = e2eId("Context segment");
  const segment = await db.translation.create({
    data: {
      projectId,
      originalHash: originalText,
      originalText,
      translatedText: "Context translation",
      langFrom: "de",
      langTo: "en",
      source: "MOCK",
      contexts: {
        create: [{ urlPath: "/context-test" }, { urlPath: "/second-context" }],
      },
    },
  });
  try {
    await page.goto(`/projects/${projectId}/translations/pros`);
    await page.getByPlaceholder("Search text...").fill(originalText);
    await page.getByRole("button", { name: "Search", exact: true }).click();
    await page.getByLabel("Translation source").selectOption("MOCK");
    await page.getByLabel("Editing mode").selectOption("automatic");
    await page
      .getByLabel("Page context", { exact: true })
      .selectOption("known");
    const row = page.locator("article").filter({ hasText: originalText });
    await expect(row).toHaveCount(1);
    await row.locator("summary").click();
    await expect(row.getByRole("link", { name: "Open page" })).toHaveCount(2);
    const filtersFit = () =>
      page.locator("form").evaluate((form) => {
        const bounds = form.getBoundingClientRect();
        return Array.from(form.querySelectorAll("input,select,button")).every(
          (element) => {
            const rect = element.getBoundingClientRect();
            return (
              rect.left >= bounds.left - 1 && rect.right <= bounds.right + 1
            );
          },
        );
      });
    expect(await filtersFit()).toBe(true);
    await page.setViewportSize({ width: 390, height: 844 });
    expect(await filtersFit()).toBe(true);
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.screenshot({
      path: "output/playwright/translation-context-workspace.png",
      fullPage: true,
    });
    await row
      .getByRole("button", { name: "/context-test", exact: true })
      .click();
    await expect(page.getByLabel("Page path", { exact: true })).toHaveValue(
      "/context-test",
    );
    await expect(row).toHaveCount(1);
    await page.getByLabel("Sort order").selectOption("original_asc");
    await row.getByRole("button", { name: "Edit", exact: true }).click();
    await row.locator("textarea").fill("Manually changed context translation");
    await row.getByRole("button", { name: "Save", exact: true }).click();
    await expect(row).toHaveCount(0);
    await page.getByRole("button", { name: "Reset filters" }).click();
    await page.getByPlaceholder("Search text...").fill(originalText);
    await page.getByRole("button", { name: "Search", exact: true }).click();
    await page.getByLabel("Editing mode").selectOption("manual");
    await expect(row).toHaveCount(1);
    await expect(row).toContainText("Manually changed context translation");
    const invalid = await page.request.get(
      `/api/projects/${projectId}/translations?sort=invalid`,
    );
    expect(invalid.status()).toBe(400);
    for (const path of [
      "//foreign.test",
      "/private?token=x",
      "/bad\u0000path",
    ]) {
      const invalidPath = await page.request.get(
        `/api/projects/${projectId}/translations?${new URLSearchParams({ urlPath: path })}`,
      );
      expect(invalidPath.status()).toBe(400);
    }
  } finally {
    await db.translation.delete({ where: { id: segment.id } });
    await db.$disconnect();
  }
});

test("real translation requests record fresh and cached page context without private URL data", async ({
  page,
}) => {
  const projectId = await signInAndGetProjectId(page);
  const project = await db.project.findUniqueOrThrow({
    where: { id: projectId },
  });
  const rawKey = `dg_live_context_${crypto.randomUUID()}`;
  const key = await db.apiKey.create({
    data: {
      projectId,
      name: "Context E2E",
      key: createHash("sha256").update(rawKey).digest("hex"),
      keyPrefix: rawKey.slice(0, 12),
    },
  });
  const text = e2eId("Neue Seite");
  try {
    for (const path of [
      "/fresh-context?private=secret#fragment",
      "/cached-context?private=secret#fragment",
      "/cache-only-human-context?private=secret#fragment",
    ]) {
      const response = await page.request.post("/api/translate", {
        headers: { Authorization: `Bearer ${rawKey}` },
        data: {
          l_from: "de",
          l_to: "en",
          words: [{ t: 1, w: text }],
          request_url: `http://${project.domain}${path}`,
          // WordPress uses OTHER (1) to keep automatic-translation-disabled
          // human page loads cache-only as well as actual crawler requests.
          bot: path.startsWith("/cache-only-human") ? 1 : 0,
        },
      });
      expect(response.status(), await response.text()).toBe(200);
      if (path.startsWith("/cache-only-human")) {
        expect((await response.json()).cache_only).toBe(true);
        expect(await db.translationBatchLog.count({ where: {
          projectId, requestUrl: `http://${project.domain}${path}`,
        } })).toBe(0);
      }
    }
    const segment = await db.translation.findFirstOrThrow({
      where: { projectId, originalText: text },
      include: { contexts: { orderBy: { urlPath: "asc" } } },
    });
    expect(segment.contexts.map((context) => context.urlPath).sort()).toEqual([
      "/cache-only-human-context",
      "/cached-context",
      "/fresh-context",
    ]);
    const firstSeen = segment.updatedAt;
    await page.request.post("/api/translate", {
      headers: { Authorization: `Bearer ${rawKey}` },
      data: {
        l_from: "de",
        l_to: "en",
        words: [{ t: 1, w: text }],
        request_url: `http://${project.domain}/cached-context`,
      },
    });
    expect(
      (await db.translation.findUniqueOrThrow({ where: { id: segment.id } }))
        .updatedAt,
    ).toEqual(firstSeen);
  } finally {
    await db.translation.deleteMany({
      where: { projectId, originalText: text },
    });
    await db.apiKey.delete({ where: { id: key.id } });
    await db.$disconnect();
  }
});

test("editing the last filtered page returns to a valid page", async ({
  page,
}) => {
  const projectId = await signInAndGetProjectId(page);
  const marker = e2eId("Pagination context");
  await db.translation.createMany({
    data: Array.from({ length: 26 }, (_, index) => ({
      projectId,
      originalHash: `${marker}-${index}`,
      originalText: `${marker}-${index}`,
      translatedText: `Translated ${index}`,
      langFrom: "de",
      langTo: "en",
      source: "MOCK" as const,
    })),
  });
  try {
    await page.goto(`/projects/${projectId}/translations/pros`);
    await page.getByPlaceholder("Search text...").fill(marker);
    await page.getByRole("button", { name: "Search", exact: true }).click();
    await page.getByLabel("Editing mode").selectOption("automatic");
    await expect(page.locator("article")).toHaveCount(25);
    await page.getByRole("button", { name: "Next", exact: true }).click();
    await expect(page.locator("article")).toHaveCount(1);
    await page
      .locator("article")
      .getByRole("button", { name: "Edit", exact: true })
      .click();
    await page.locator("textarea").fill("Manual pagination edit");
    await page.getByRole("button", { name: "Save", exact: true }).click();
    await expect(page.locator("article")).toHaveCount(25);
    await expect(
      page.getByRole("button", { name: "Previous", exact: true }),
    ).toHaveCount(0);
  } finally {
    await db.translation.deleteMany({
      where: { projectId, originalText: { startsWith: marker } },
    });
    await db.$disconnect();
  }
});
