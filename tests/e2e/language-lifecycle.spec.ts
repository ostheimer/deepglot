import { createHash } from "node:crypto";
import { expect, test } from "@playwright/test";

import { db } from "../../src/lib/db";
import { computeTranslationHash } from "../../src/lib/translation-hash";
import { e2eId, signInAndGetProjectId } from "./helpers";

test("manager controls a regional target independently and removes only confirmed target data", async ({ page, request }) => {
  const projectId = await signInAndGetProjectId(page);
  const path = `/api/projects/${projectId}/languages`;
  const langCode = "en-at";
  const marker = e2eId("Lifecycle fixture");
  const rawKey = `dg_live_lifecycle_${crypto.randomUUID()}`;
  const key = await db.apiKey.create({ data: {
    projectId, name: "Lifecycle fixture", key: createHash("sha256").update(rawKey).digest("hex"), keyPrefix: rawKey.slice(0, 12),
  } });
  try {
    expect((await request.get(`${path}?langCode=${langCode}`)).status()).toBe(401);
    expect((await page.request.post(path, { data: { languages: ["EN_at"] } })).status()).toBe(200);
    const row = await db.projectLanguage.findUniqueOrThrow({ where: { projectId_langCode: { projectId, langCode } } });
    expect(row).toMatchObject({ isActive: true, isVisible: true, automaticTranslation: true });

    const baseText = `${marker} base`;
    await db.translation.create({ data: {
      projectId, langFrom: "de", langTo: "en", originalHash: computeTranslationHash(baseText, "de", "en"),
      originalText: baseText, translatedText: "Existing English fallback", isManual: true, wordCount: 3,
    } });
    await db.translation.create({ data: {
      projectId, langFrom: "de", langTo: langCode, originalHash: computeTranslationHash(`${marker} own`, "de", langCode),
      originalText: `${marker} own`, translatedText: "Own regional content", isManual: true, wordCount: 3,
    } });
    await db.urlSlug.create({ data: { projectId, langTo: langCode, originalSlug: `${marker}-slug`, translatedSlug: `${marker}-regional` } });
    await db.translatedUrl.create({ data: { projectId, langTo: langCode, urlPath: `/${marker}`, wordCount: 3, requestCount: 1 } });

    expect((await page.request.patch(path, { data: { langCode, isVisible: false, automaticTranslation: false } })).status()).toBe(200);
    const runtime = await request.get("/api/plugin/runtime-config", { headers: { Authorization: `Bearer ${rawKey}` } });
    expect(runtime.status(), await runtime.text()).toBe(200);
    expect((await runtime.json()).project).toMatchObject({
      targetLanguages: expect.arrayContaining([langCode]),
      visibleTargetLanguages: expect.not.arrayContaining([langCode]),
      automaticTargetLanguages: expect.not.arrayContaining([langCode]),
    });

    const translate = (text: string) => page.request.post("/api/translate", {
      headers: { Authorization: `Bearer ${rawKey}` },
      data: { l_from: "de", l_to: langCode, words: [{ t: 1, w: text }] },
    });
    const fallback = await translate(baseText);
    expect(fallback.status(), await fallback.text()).toBe(200);
    expect((await fallback.json()).to_words).toEqual(["Existing English fallback"]);
    const miss = await translate(`${marker} cache miss`);
    expect(miss.status(), await miss.text()).toBe(200);
    expect((await miss.json()).cache_only).toBe(true);
    expect(await db.translation.count({ where: { projectId, langTo: langCode, originalText: `${marker} cache miss` } })).toBe(0);

    const bulk = await page.request.put(path, { data: { action: "disable", languages: [{ langCode }, { langCode: "pt-br" }] } });
    expect(bulk.status()).toBe(200);
    expect((await bulk.json()).results).toEqual([{ langCode, status: "updated" }, { langCode: "pt-br", status: "not_found" }]);
    expect((await translate(baseText)).status()).toBe(400);
    expect((await page.request.put(path, { data: { action: "enable", languages: [{ langCode }] } })).status()).toBe(200);

    const before = await page.request.get(`${path}?langCode=${langCode}`);
    expect(before.status()).toBe(200);
    const preview = (await before.json()).preview;
    expect(preview).toMatchObject({ translations: 1, urls: 1, slugs: 1 });
    await db.urlSlug.create({ data: { projectId, langTo: langCode, originalSlug: `${marker}-second` } });
    const stale = await page.request.delete(path, { data: { langCode, confirmationToken: preview.confirmationToken } });
    expect(stale.status()).toBe(409);
    expect(await db.projectLanguage.count({ where: { projectId, langCode } })).toBe(1);

    await page.goto(`/projects/${projectId}/translations/languages`);
    await expect(page.getByRole("region", { name: "Manage target languages" })).toBeVisible();
    await page.getByRole("region", { name: "Manage target languages" }).getByText(langCode, { exact: true }).locator("..").locator("..").getByRole("button", { name: "Remove" }).click();
    const dialog = page.getByRole("dialog", { name: "Review language removal" });
    await expect(dialog).toContainText("2 Slugs");
    await dialog.getByRole("button", { name: "Permanently remove" }).click();
    await expect.poll(() => db.projectLanguage.count({ where: { projectId, langCode } })).toBe(0);
    expect(await db.translation.count({ where: { projectId, langTo: langCode } })).toBe(0);
    expect(await db.urlSlug.count({ where: { projectId, langTo: langCode } })).toBe(0);
    expect(await db.translation.count({ where: { projectId, langTo: "en", originalText: baseText } })).toBe(1);

    const removedImport = await page.request.post(`/api/projects/${projectId}/import`, { multipart: {
      asset: "slugs", format: "csv",
      file: { name: "removed-locale.csv", mimeType: "text/csv", buffer: Buffer.from(`originalSlug,translatedSlug,langTo,urlCount\n${marker}-import,localized,${langCode},0\n`) },
    } });
    expect(removedImport.status()).toBe(409);
    expect(await db.urlSlug.count({ where: { projectId, langTo: langCode, originalSlug: `${marker}-import` } })).toBe(0);

    expect((await page.request.post(path, { data: { languages: ["pt-br", "pt-pt"] } })).status()).toBe(200);
    const first = (await (await page.request.get(`${path}?langCode=pt-br`)).json()).preview;
    const second = (await (await page.request.get(`${path}?langCode=pt-pt`)).json()).preview;
    const bulkRemoval = await page.request.put(path, { data: { action: "remove", languages: [
      { langCode: "pt-br", confirmationToken: first.confirmationToken },
      { langCode: "pt-pt", confirmationToken: second.confirmationToken },
    ] } });
    expect(bulkRemoval.status(), await bulkRemoval.text()).toBe(200);
    expect((await bulkRemoval.json()).results).toEqual([
      { langCode: "pt-br", status: "removed" }, { langCode: "pt-pt", status: "removed" },
    ]);
  } finally {
    await db.translatedUrl.deleteMany({ where: { projectId, langTo: langCode, urlPath: { contains: marker } } });
    await db.urlSlug.deleteMany({ where: { projectId, langTo: langCode, originalSlug: { startsWith: marker } } });
    await db.translation.deleteMany({ where: { projectId, originalText: { startsWith: marker } } });
    await db.projectLanguage.deleteMany({ where: { projectId, langCode } });
    await db.projectLanguage.deleteMany({ where: { projectId, langCode: { in: ["pt-br", "pt-pt"] } } });
    await db.apiKey.delete({ where: { id: key.id } });
    await db.$disconnect();
  }
});
