import { expect, test } from "@playwright/test";
import { db } from "../../src/lib/db";
import { generateApiKey } from "../../src/lib/api-keys";
import { computeTranslationHash } from "../../src/lib/translation-hash";
import { getProjectUrl } from "../../src/lib/project-url";
import { e2eId, signInAndGetProjectId } from "./helpers";

test("authenticated WordPress source capture drives the bounded absence filter", async ({ page, request }) => {
  const projectId = await signInAndGetProjectId(page);
  const project = await db.project.findUniqueOrThrow({ where: { id: projectId } });
  const marker = e2eId("Captured source page");
  const path = `/en/source-${crypto.randomUUID()}`;
  const originalHash = computeTranslationHash(marker, "de", "en");
  const row = await db.translation.create({ data: { projectId, originalHash,
    originalText: marker, translatedText: "Captured source page", langFrom: "de", langTo: "en",
    source: "MOCK", contexts: { create: { urlPath: path } },
  } });
  const { rawKey, apiKey } = await generateApiKey({ projectId, name: "e2e source capture" });
  try {
    const body = { requestUrl: new URL(path, getProjectUrl(project.domain)).href,
      langFrom: "de", langTo: "en", originalHashes: [], complete: true,
      dynamicPossible: false, capturedMicros: String(Date.now() * 1_000) };
    const unauthenticated = await request.post("/api/plugin/source-inventory", { data: body });
    expect(unauthenticated.status()).toBe(401);
    const accepted = await request.post("/api/plugin/source-inventory", { data: body,
      headers: { Authorization: `Bearer ${rawKey}` } });
    expect(accepted.status()).toBe(200);
    expect((await accepted.json()).complete).toBe(true);
    await page.goto(`/projects/${projectId}/translations/pros`);
    await page.getByPlaceholder("Search text...").fill(marker);
    await page.getByRole("button", { name: "Search", exact: true }).click();
    await page.getByLabel("Captured source-page presence").selectOption("absent_captured_pages");
    await expect(page.locator("article")).toHaveCount(1);
    await expect(page.locator("article")).toContainText("No longer present in captured source pages");
    await expect(page.getByText("it does not establish absence from the whole website.", { exact: false })).toBeVisible();
    await page.getByRole("button", { name: "Reset filters", exact: true }).click();
    await expect(page.getByLabel("Captured source-page presence")).toHaveValue("");
  } finally {
    await db.translation.deleteMany({ where: { id: row.id } });
    await db.sourcePageSnapshot.deleteMany({ where: { projectId, urlPath: path } });
    await db.apiKey.delete({ where: { id: apiKey.id } });
    await db.$disconnect();
  }
});
