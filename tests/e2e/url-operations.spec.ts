import { createHash } from "node:crypto";
import { expect, test } from "@playwright/test";
import { db } from "../../src/lib/db";
import { computeTranslationHash } from "../../src/lib/translation-hash";
import { hashApiIdempotencyKey } from "../../src/lib/api-idempotency";
import { e2eId, signInAndGetProjectId } from "./helpers";

test("manager preview, provider charge, idempotent replay, scoped deletion and observed sync error", async ({ page, playwright }) => {
  const projectId = await signInAndGetProjectId(page);
  const project = await db.project.findUniqueOrThrow({ where: { id: projectId } });
  const path = `/${e2eId("url-operation")}`;
  const oldPath = `${path}-other`;
  const url = await db.translatedUrl.create({ data: { projectId, urlPath: path, langTo: "en", wordCount: 4, requestCount: 2 } });
  const marker = e2eId("Unique source");
  const make = (text: string, extra: Record<string, unknown> = {}, paths = [path]) => db.translation.create({ data: {
    projectId, originalHash: computeTranslationHash(text, "de", "en"), originalText: text,
    translatedText: `old ${text}`, langFrom: "de", langTo: "en", source: "MOCK",
    contexts: { create: paths.map((urlPath) => ({ urlPath })) }, ...extra,
  } });
  const exclusive = await make(marker);
  const shared = await make(`${marker} shared`, {}, [path, oldPath]);
  const manual = await make(`${marker} manual`, { isManual: true, source: "MANUAL" });
  const approved = await make(`${marker} reviewed`, { workflowStatus: "APPROVED" });
  const rawKey = `dg_live_urlops_${crypto.randomUUID()}`;
  const key = await db.apiKey.create({ data: { projectId, name: "URL operations fixture", key: createHash("sha256").update(rawKey).digest("hex"), keyPrefix: rawKey.slice(0, 16) } });
  const endpoint = `/api/projects/${projectId}/url-operations`;
  const post = (data: unknown, key?: string) => page.request.post(endpoint, { data, headers: key ? { "Idempotency-Key": key } : {} });
  try {
    const anonymous = await playwright.request.newContext({ baseURL: process.env.PLAYWRIGHT_BASE_URL ?? "http://localhost:31563" });
    expect((await anonymous.post(endpoint, { data: { action: "delete", id: url.id } })).status()).toBe(401);
    await anonymous.dispose();

    const beforeUsage = await db.usageRecord.aggregate({ where: { projectId }, _sum: { words: true } });
    const stalePreview = await (await post({ action: "retranslate", id: url.id })).json();
    await db.translation.update({ where: { id: exclusive.id }, data: { translatedText: `newer ${marker}` } });
    const stale = await post({ action: "retranslate", id: url.id, confirmation: stalePreview.confirmation }, stalePreview.confirmation);
    expect(stale.status()).toBe(409);
    expect((await db.usageRecord.aggregate({ where: { projectId }, _sum: { words: true } }))._sum.words).toBe(beforeUsage._sum.words);
    const previewResponse = await post({ action: "retranslate", id: url.id });
    expect(previewResponse.status(), await previewResponse.text()).toBe(200);
    const preview = await previewResponse.json();
    expect(preview).toMatchObject({ affectedSegments: 1, sharedSegments: 1, protectedSegments: 2, canRetranslate: true });
    expect(preview.billableWords).toBeGreaterThan(0);
    const action = { action: "retranslate", id: url.id, confirmation: preview.confirmation };
    const done = await post(action, preview.confirmation);
    expect(done.status(), await done.text()).toBe(200);
    expect((await done.json()).billedWords).toBe(preview.billableWords);
    expect((await db.translation.findUniqueOrThrow({ where: { id: exclusive.id } })).translatedText).toBe(`[en] ${marker}`);
    expect(await db.urlCacheInvalidation.count({ where: { projectId, urlPath: path } })).toBe(1);
    const runtime = await page.request.get("/api/plugin/runtime-config?cache_after=0", { headers: { Authorization: `Bearer ${rawKey}` } });
    expect(runtime.status(), await runtime.text()).toBe(200);
    const feed = (await runtime.json()).cacheInvalidations.entries;
    expect(feed.some((item: { cacheKey: string }) => item.cacheKey === createHash("sha1").update(`de|en|${marker}`).digest("hex"))).toBe(true);
    expect(JSON.stringify(feed)).not.toContain(marker);
    const usage = await db.usageRecord.aggregate({ where: { projectId }, _sum: { words: true } });
    expect((usage._sum.words ?? 0) - (beforeUsage._sum.words ?? 0)).toBe(preview.billableWords);
    const replay = await post(action, preview.confirmation);
    expect(replay.status()).toBe(200);
    expect((await db.usageRecord.aggregate({ where: { projectId }, _sum: { words: true } }))._sum.words).toBe(usage._sum.words);
    expect((await db.translatedUrl.findUniqueOrThrow({ where: { id: url.id } })).requestCount).toBe(2);
    const actorId = (await db.user.findUniqueOrThrow({ where: { email: "preview@deepglot.local" } })).id;
    await db.apiIdempotencyRecord.delete({ where: { scope_keyHash: { scope: `manager:url-operation:${projectId}:${actorId}`, keyHash: hashApiIdempotencyKey(preview.confirmation) } } });
    await db.translatedUrl.update({ where: { id: url.id }, data: { operationState: "provider_pending", lastResult: "provider_outcome_unknown", operationToken: preview.confirmation } });
    const recovered = await post(action, preview.confirmation);
    expect(recovered.status(), await recovered.text()).toBe(200);
    expect((await recovered.json()).reconciledFromReceipt).toBe(true);
    expect((await db.usageRecord.aggregate({ where: { projectId }, _sum: { words: true } }))._sum.words).toBe(usage._sum.words);

    const deletePreview = await (await post({ action: "delete", id: url.id })).json();
    const deleted = await post({ action: "delete", id: url.id, confirmation: deletePreview.confirmation }, deletePreview.confirmation);
    expect(deleted.status(), await deleted.text()).toBe(200);
    expect((await deleted.json()).deletedSegments).toBe(1);
    expect(await db.urlCacheInvalidation.count({ where: { projectId, urlPath: path } })).toBe(2);
    expect(await db.translation.findUnique({ where: { id: exclusive.id } })).toBeNull();
    for (const id of [shared.id, manual.id, approved.id]) expect(await db.translation.findUnique({ where: { id } })).not.toBeNull();
    expect(await db.translationContext.count({ where: { urlPath: path, translationId: { in: [shared.id, manual.id, approved.id] } } })).toBe(0);
    expect((await db.usageRecord.aggregate({ where: { projectId }, _sum: { words: true } }))._sum.words).toBe(usage._sum.words);

    const sync = await page.request.post("/api/plugin/url-sync-result", { headers: { Authorization: `Bearer ${rawKey}` }, data: { url: `http://${project.domain}${path}`, language: "en", state: "failed", result: "http_503", httpStatus: 503 } });
    expect(sync.status(), await sync.text()).toBe(200);
    await page.goto(`/projects/${projectId}/translations/urls?lang=en&status=failed`);
    await expect(page.getByText(path, { exact: true })).toBeVisible();
    await expect(page.getByText("HTTP 503")).toBeVisible();
    await page.screenshot({ path: "output/playwright/url-operations-error-report.png", fullPage: true });
  } finally {
    await db.urlCacheInvalidation.deleteMany({ where: { projectId, urlPath: path } });
    await db.urlOperationReceipt.deleteMany({ where: { projectId, urlId: url.id } });
    await db.apiKey.delete({ where: { id: key.id } });
    await db.translatedUrl.deleteMany({ where: { projectId, urlPath: path } });
    await db.translation.deleteMany({ where: { id: { in: [exclusive.id, shared.id, manual.id, approved.id] } } });
    await db.$disconnect();
  }
});

test("a confirmed two-URL selection bills each segment once despite its own quota changes", async ({ page }) => {
  const projectId = await signInAndGetProjectId(page);
  const endpoint = `/api/projects/${projectId}/url-operations`;
  const records: Array<{ urlId: string; translationId: string; path: string }> = [];
  try {
    for (const suffix of ["first", "second"]) {
      const path = `/${e2eId(`bulk-${suffix}`)}`;
      const text = e2eId(`Bulk ${suffix}`);
      const url = await db.translatedUrl.create({ data: { projectId, urlPath: path, langTo: "en", wordCount: 2 } });
      const translation = await db.translation.create({ data: {
        projectId, originalHash: computeTranslationHash(text, "de", "en"), originalText: text,
        translatedText: `old ${text}`, langFrom: "de", langTo: "en", source: "MOCK",
        contexts: { create: [{ urlPath: path }] },
      } });
      records.push({ urlId: url.id, translationId: translation.id, path });
    }
    const post = (data: unknown, key?: string) => page.request.post(endpoint, { data, headers: key ? { "Idempotency-Key": key } : {} });
    const previews = await Promise.all(records.map(async ({ urlId }) => {
      const response = await post({ action: "retranslate", id: urlId });
      expect(response.status()).toBe(200);
      return response.json();
    }));
    const initialUsage = (await db.usageRecord.aggregate({ where: { projectId }, _sum: { words: true } }))._sum.words ?? 0;
    const totalWords = previews.reduce((sum, preview) => sum + preview.billableWords, 0);
    expect(previews[0].wordsUsed + totalWords).toBeLessThanOrEqual(previews[0].wordsLimit);
    for (let index = 0; index < records.length; index++) {
      const preview = previews[index];
      const data = { action: "retranslate", id: records[index].urlId, confirmation: preview.confirmation };
      const response = await post(data, preview.confirmation);
      expect(response.status(), await response.text()).toBe(200);
      expect((await response.json()).billedWords).toBe(preview.billableWords);
      const replay = await post(data, preview.confirmation);
      expect(replay.status()).toBe(200);
    }
    const finalUsage = (await db.usageRecord.aggregate({ where: { projectId }, _sum: { words: true } }))._sum.words ?? 0;
    expect(finalUsage - initialUsage).toBe(totalWords);
  } finally {
    await db.urlCacheInvalidation.deleteMany({ where: { projectId, urlPath: { in: records.map(({ path }) => path) } } });
    await db.urlOperationReceipt.deleteMany({ where: { projectId, urlId: { in: records.map(({ urlId }) => urlId) } } });
    await db.translation.deleteMany({ where: { id: { in: records.map(({ translationId }) => translationId) } } });
    await db.translatedUrl.deleteMany({ where: { id: { in: records.map(({ urlId }) => urlId) } } });
    await db.$disconnect();
  }
});

test("a URL with 251 eligible segments reports the full scope and continues in bounded steps", async ({ page }) => {
  const projectId = await signInAndGetProjectId(page);
  const path = `/${e2eId("large-url")}`;
  const otherPath = `${path}-shared`;
  const url = await db.translatedUrl.create({ data: { projectId, urlPath: path, langTo: "en", wordCount: 251 } });
  const texts = Array.from({ length: 251 }, (_, index) => `${e2eId("segment")} ${index}`);
  const manualText = e2eId("protected before");
  const sharedText = e2eId("shared after");
  let manualId: string | null = null;
  let sharedId: string | null = null;
  try {
    const manual = await db.translation.create({ data: { projectId, originalHash: computeTranslationHash(manualText, "de", "en"), originalText: manualText, translatedText: "manual", langFrom: "de", langTo: "en", source: "MANUAL", isManual: true, contexts: { create: [{ urlPath: path }] } } });
    manualId = manual.id;
    await db.translation.createMany({ data: texts.map((text) => ({
      projectId, originalHash: computeTranslationHash(text, "de", "en"), originalText: text,
      translatedText: `old ${text}`, langFrom: "de", langTo: "en", source: "MOCK",
    })) });
    const translations = await db.translation.findMany({ where: { projectId, originalHash: { in: texts.map((text) => computeTranslationHash(text, "de", "en")) } }, select: { id: true } });
    await db.translationContext.createMany({ data: translations.map(({ id }) => ({ translationId: id, urlPath: path })) });
    const shared = await db.translation.create({ data: { projectId, originalHash: computeTranslationHash(sharedText, "de", "en"), originalText: sharedText, translatedText: "shared", langFrom: "de", langTo: "en", source: "MOCK", contexts: { create: [{ urlPath: path }, { urlPath: otherPath }] } } });
    sharedId = shared.id;
    const post = (data: unknown, key?: string) => page.request.post(`/api/projects/${projectId}/url-operations`, { data, headers: key ? { "Idempotency-Key": key } : {} });
    const first = await (await post({ action: "delete", id: url.id })).json();
    expect(first).toMatchObject({ affectedSegments: 250, totalEligibleSegments: 251, remainingSegments: 1, protectedSegments: 1, sharedSegments: 1 });
    expect(first.nextAfterId).toBeTruthy();
    const firstResult = await post({ action: "delete", id: url.id, confirmation: first.confirmation }, first.confirmation);
    expect(firstResult.status(), await firstResult.text()).toBe(200);
    expect((await firstResult.json()).nextAfterId).toBe(first.nextAfterId);
    expect(await db.translatedUrl.findUnique({ where: { id: url.id } })).not.toBeNull();
    expect(await db.translationContext.count({ where: { urlPath: path } })).toBe(3);
    const second = await (await post({ action: "delete", id: url.id, afterId: first.nextAfterId })).json();
    expect(second).toMatchObject({ affectedSegments: 1, remainingSegments: 0 });
    const done = await post({ action: "delete", id: url.id, afterId: first.nextAfterId, confirmation: second.confirmation }, second.confirmation);
    expect(done.status(), await done.text()).toBe(200);
    expect(await db.translatedUrl.findUnique({ where: { id: url.id } })).toBeNull();
    expect(await db.translationContext.count({ where: { urlPath: path } })).toBe(0);
    expect(await db.translation.findUnique({ where: { id: manual.id } })).not.toBeNull();
    expect(await db.translation.findUnique({ where: { id: shared.id } })).not.toBeNull();
    expect(await db.translationContext.count({ where: { urlPath: otherPath, translationId: shared.id } })).toBe(1);
  } finally {
    await db.urlCacheInvalidation.deleteMany({ where: { projectId, urlPath: path } });
    await db.translation.deleteMany({ where: { projectId, originalHash: { in: texts.map((text) => computeTranslationHash(text, "de", "en")) } } });
    if (manualId) await db.translation.deleteMany({ where: { id: manualId } });
    if (sharedId) await db.translation.deleteMany({ where: { id: sharedId } });
    await db.translatedUrl.deleteMany({ where: { id: url.id } });
    await db.$disconnect();
  }
});

test("an unknown provider outcome blocks replay and delete without another charge", async ({ page }) => {
  const projectId = await signInAndGetProjectId(page);
  const project = await db.project.findUniqueOrThrow({ where: { id: projectId } });
  const path = `/${e2eId("pending-url")}`;
  const text = e2eId("Pending source");
  const url = await db.translatedUrl.create({ data: { projectId, urlPath: path, langTo: "en" } });
  const translation = await db.translation.create({ data: {
    projectId, originalHash: computeTranslationHash(text, "de", "en"), originalText: text,
    translatedText: "old", langFrom: "de", langTo: "en", source: "MOCK",
    contexts: { create: [{ urlPath: path }] },
  } });
  const rawKey = `dg_live_urlops_${crypto.randomUUID()}`;
  const key = await db.apiKey.create({ data: { projectId, name: "Pending URL fixture", key: createHash("sha256").update(rawKey).digest("hex"), keyPrefix: rawKey.slice(0, 16) } });
  const post = (data: unknown, key?: string) => page.request.post(`/api/projects/${projectId}/url-operations`, { data, headers: key ? { "Idempotency-Key": key } : {} });
  try {
    const preview = await (await post({ action: "retranslate", id: url.id })).json();
    const usageBefore = (await db.usageRecord.aggregate({ where: { projectId }, _sum: { words: true } }))._sum.words;
    // Simulate the durable marker left by an interrupted provider call.
    await db.translatedUrl.update({ where: { id: url.id }, data: { operationState: "provider_pending", lastResult: "provider_outcome_unknown", operationToken: preview.confirmation, lastOperationAt: new Date() } });
    const replay = await post({ action: "retranslate", id: url.id, confirmation: preview.confirmation }, preview.confirmation);
    expect(replay.status()).toBe(409);
    const fresh = await (await post({ action: "retranslate", id: url.id })).json();
    expect(fresh).toMatchObject({ canRetranslate: false, reason: "provider_outcome_unknown" });
    const deletePreview = await (await post({ action: "delete", id: url.id })).json();
    expect(deletePreview.canDelete).toBe(false);
    const deleteAttempt = await post({ action: "delete", id: url.id, confirmation: deletePreview.confirmation }, deletePreview.confirmation);
    expect(deleteAttempt.status()).toBe(409);
    const sync = await page.request.post("/api/plugin/url-sync-result", { headers: { Authorization: `Bearer ${rawKey}` }, data: { url: `http://${project.domain}${path}`, language: "en", state: "failed", result: "http_503", httpStatus: 503 } });
    expect(sync.status()).toBe(409);
    expect((await db.translatedUrl.findUniqueOrThrow({ where: { id: url.id } })).operationState).toBe("provider_pending");
    expect((await db.usageRecord.aggregate({ where: { projectId }, _sum: { words: true } }))._sum.words).toBe(usageBefore);
  } finally {
    await db.apiKey.delete({ where: { id: key.id } });
    await db.translation.delete({ where: { id: translation.id } });
    await db.translatedUrl.delete({ where: { id: url.id } });
    await db.$disconnect();
  }
});
