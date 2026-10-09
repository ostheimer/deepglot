import { createHash } from "node:crypto";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import bcrypt from "bcryptjs";
import { expect, test } from "@playwright/test";
import { db } from "../../src/lib/db";
import { computeTranslationHash } from "../../src/lib/translation-hash";
import { hashApiIdempotencyKey } from "../../src/lib/api-idempotency";
import { getProjectUrl } from "../../src/lib/project-url";
import { e2eId, signInAndGetProjectId } from "./helpers";

async function waitForBlockedProjectLock() {
  for (let attempt = 0; attempt < 80; attempt++) {
    const rows = await db.$queryRaw<Array<{ waiting: bigint }>>`
      SELECT count(*)::bigint AS waiting FROM pg_stat_activity
      WHERE pid <> pg_backend_pid() AND wait_event_type = 'Lock'
        AND query LIKE '%FROM "Project"%' AND query LIKE '%FOR UPDATE%'
    `;
    if (rows[0]?.waiting > BigInt(0)) return;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error("Timed out waiting for the URL operation to reach the project write lock");
}

async function waitForBlockedOrganizationLock() {
  for (let attempt = 0; attempt < 80; attempt++) {
    const rows = await db.$queryRaw<Array<{ waiting: bigint }>>`
      SELECT count(*)::bigint AS waiting FROM pg_stat_activity
      WHERE pid <> pg_backend_pid() AND wait_event_type = 'Lock'
        AND query LIKE '%FROM "Organization"%' AND query LIKE '%FOR UPDATE%'
    `;
    if (rows[0]?.waiting > BigInt(0)) return;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error("Timed out waiting for the URL action to reach the organization write lock");
}

async function startBarrierProvider() {
  let calls = 0;
  let signalStarted!: () => void;
  let release!: () => void;
  const started = new Promise<void>((resolve) => { signalStarted = resolve; });
  const barrier = new Promise<void>((resolve) => { release = resolve; });
  const server = createServer(async (_request, response) => {
    calls++;
    signalStarted();
    await barrier;
    response.writeHead(200, { "Content-Type": "application/json" });
    response.end(JSON.stringify({ choices: [{ message: { content: JSON.stringify({ translations: [{ text: "new mock translation", detectedSourceLanguage: "DE" }] }) } }] }));
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  return {
    baseUrl: `http://127.0.0.1:${(server.address() as AddressInfo).port}/v1`,
    started,
    release,
    calls: () => calls,
    close: async () => { release(); await new Promise<void>((resolve) => server.close(() => resolve())); },
  };
}

test("language-bound translator reads URL inventory without manager controls", async ({ page }) => {
  const projectId = await signInAndGetProjectId(page);
  const email = `${e2eId("url-translator")}@example.test`;
  const password = e2eId("password");
  const user = await db.user.create({ data: { email, password: await bcrypt.hash(password, 10) } });
  const member = await db.projectMember.create({ data: { projectId, userId: user.id, email, role: "TRANSLATOR", langCode: "en" } });
  const path = `/${e2eId("translator-url")}`;
  const english = await db.translatedUrl.create({ data: { projectId, urlPath: path, langTo: "en" } });
  const french = await db.translatedUrl.create({ data: { projectId, urlPath: path, langTo: "fr" } });
  try {
    await page.context().clearCookies();
    await page.goto("/en/login");
    await expect(page.getByRole("heading", { name: "Welcome back" })).toBeVisible();
    await page.getByLabel("Email").fill(email);
    await page.getByLabel("Password").fill(password);
    await page.getByRole("button", { name: "Sign in", exact: true }).click();
    await page.waitForURL(/\/dashboard$/);
    const inventory = await page.goto(`/projects/${projectId}/translations/urls?lang=en`);
    expect(inventory?.status()).toBe(200);
    await expect(page.getByText(path, { exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "Retranslate" })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Delete" })).toHaveCount(0);
    await expect(page.getByRole("checkbox")).toHaveCount(0);
    await expect(page.getByText("Open WordPress to confirm retry")).toHaveCount(0);
    await expect(page.getByRole("link", { name: "FR" })).toHaveCount(0);
    expect((await page.goto(`/projects/${projectId}/translations/urls?lang=fr`))?.status()).toBe(404);
    const denied = await page.request.post(`/api/projects/${projectId}/url-operations`, { data: { action: "delete", id: english.id } });
    expect(denied.status()).toBe(404);
  } finally {
    await db.translatedUrl.deleteMany({ where: { id: { in: [english.id, french.id] } } });
    await db.projectMember.delete({ where: { id: member.id } });
    await db.user.delete({ where: { id: user.id } });
  }
});

test("manager revocation before URL claim and delete write denies both actions", async ({ page }) => {
  const projectId = await signInAndGetProjectId(page);
  const project = await db.project.findUniqueOrThrow({ where: { id: projectId } });
  const actor = await db.user.findUniqueOrThrow({ where: { email: "preview@deepglot.local" } });
  const membership = await db.organizationMember.findUniqueOrThrow({ where: { userId_organizationId: { userId: actor.id, organizationId: project.organizationId } } });
  const path = `/${e2eId("revoked-manager")}`;
  const text = e2eId("Revoked manager segment");
  const url = await db.translatedUrl.create({ data: { projectId, urlPath: path, langTo: "en" } });
  const translation = await db.translation.create({ data: { projectId, originalHash: computeTranslationHash(text, "de", "en"), originalText: text, translatedText: `old ${text}`, langFrom: "de", langTo: "en", source: "MOCK", contexts: { create: [{ urlPath: path }] } } });
  const endpoint = `/api/projects/${projectId}/url-operations`;
  try {
    for (const action of ["retranslate", "delete"] as const) {
      const previewResponse = await page.request.post(endpoint, { data: { action, id: url.id } });
      expect(previewResponse.status()).toBe(200);
      const preview = await previewResponse.json();
      const beforeUsage = (await db.usageRecord.aggregate({ where: { projectId }, _sum: { words: true } }))._sum.words;
      let pending!: ReturnType<typeof page.request.post>;
      await db.$transaction(async (tx) => {
        await tx.$queryRaw`SELECT id FROM "Organization" WHERE id = ${project.organizationId} FOR UPDATE`;
        pending = page.request.post(endpoint, { data: { action, id: url.id, confirmation: preview.confirmation }, headers: { "Idempotency-Key": preview.confirmation } });
        await waitForBlockedOrganizationLock();
        await tx.organizationMember.update({ where: { id: membership.id }, data: { role: "MEMBER" } });
      }, { timeout: 15_000 });
      const denied = await pending;
      expect(denied.status(), await denied.text()).toBe(404);
      expect((await db.translation.findUniqueOrThrow({ where: { id: translation.id } })).translatedText).toBe(`old ${text}`);
      expect(await db.translatedUrl.findUnique({ where: { id: url.id } })).not.toBeNull();
      expect((await db.usageRecord.aggregate({ where: { projectId }, _sum: { words: true } }))._sum.words).toBe(beforeUsage);
      await db.organizationMember.update({ where: { id: membership.id }, data: { role: membership.role } });
    }
  } finally {
    await db.organizationMember.update({ where: { id: membership.id }, data: { role: membership.role } });
    await db.translation.deleteMany({ where: { id: translation.id } });
    await db.translatedUrl.deleteMany({ where: { id: url.id } });
  }
});

test("revoked API key cannot record a WordPress URL status after validation", async ({ page }) => {
  const projectId = await signInAndGetProjectId(page);
  const project = await db.project.findUniqueOrThrow({ where: { id: projectId } });
  const rawKey = `dg_live_urlops_${crypto.randomUUID()}`;
  const key = await db.apiKey.create({ data: { projectId, name: "Revocation URL sync fixture", key: createHash("sha256").update(rawKey).digest("hex"), keyPrefix: rawKey.slice(0, 16) } });
  const path = `/${e2eId("revoked-key")}`;
  try {
    let pending!: ReturnType<typeof page.request.post>;
    await db.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM "Organization" WHERE id = ${project.organizationId} FOR UPDATE`;
      pending = page.request.post("/api/plugin/url-sync-result", { headers: { Authorization: `Bearer ${rawKey}` }, data: { url: `http://${project.domain}${path}`, language: "en", state: "failed", result: "http_503", httpStatus: 503 } });
      await waitForBlockedOrganizationLock();
      await tx.apiKey.update({ where: { id: key.id }, data: { isActive: false } });
    }, { timeout: 15_000 });
    const denied = await pending;
    expect(denied.status(), await denied.text()).toBe(401);
    expect(await db.translatedUrl.findUnique({ where: { projectId_urlPath_langTo: { projectId, urlPath: path, langTo: "en" } } })).toBeNull();
  } finally {
    await db.translatedUrl.deleteMany({ where: { projectId, urlPath: path, langTo: "en" } });
    await db.apiKey.delete({ where: { id: key.id } });
  }
});

test("WordPress sync result accepts a canonical script and region locale", async ({ page }) => {
  const projectId = await signInAndGetProjectId(page);
  const project = await db.project.findUniqueOrThrow({ where: { id: projectId } });
  const language = await db.projectLanguage.create({ data: { projectId, langCode: "yue-hant-hk" } });
  const rawKey = `dg_live_urlops_${crypto.randomUUID()}`;
  const key = await db.apiKey.create({ data: { projectId, name: "Locale URL sync fixture", key: createHash("sha256").update(rawKey).digest("hex"), keyPrefix: rawKey.slice(0, 16) } });
  const path = `/${e2eId("locale-sync")}`;
  try {
    const response = await page.request.post("/api/plugin/url-sync-result", { headers: { Authorization: `Bearer ${rawKey}` }, data: { url: `http://${project.domain}${path}`, language: "YUE_HANT_HK", state: "failed", result: "http_503", httpStatus: 503 } });
    expect(response.status(), await response.text()).toBe(200);
    expect(await db.translatedUrl.findUnique({ where: { projectId_urlPath_langTo: { projectId, urlPath: path, langTo: "yue-hant-hk" } } })).toMatchObject({ operationState: "sync_failed", lastHttpStatus: 503 });
  } finally {
    await db.translatedUrl.deleteMany({ where: { projectId, urlPath: path, langTo: "yue-hant-hk" } });
    await db.apiKey.delete({ where: { id: key.id } });
    await db.projectLanguage.delete({ where: { id: language.id } });
  }
});

test("manager preview, provider charge, idempotent replay, scoped deletion and observed sync error", async ({ page, playwright }) => {
  const projectId = await signInAndGetProjectId(page);
  const project = await db.project.findUniqueOrThrow({ where: { id: projectId } });
  const path = `/${e2eId("url-operation")}`;
  const canonicalPath = `${path}-canonical`;
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
    const anonymous = await playwright.request.newContext({ baseURL: new URL(page.url()).origin });
    expect((await anonymous.post(endpoint, { data: { action: "delete", id: url.id } })).status()).toBe(401);
    await anonymous.dispose();
    await page.goto(`/projects/${projectId}/translations/urls?lang=en&q=${encodeURIComponent(path)}`);
    await expect(page.getByRole("link", { name: `Open ${path}` })).toHaveAttribute(
      "href",
      new URL(path, getProjectUrl(project.domain)).toString()
    );

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
    await expect(page.getByRole("link", { name: "Open WordPress to confirm retry" })).toBeVisible();
    expect(await db.translatedUrl.findUnique({ where: { projectId_urlPath_langTo: { projectId, urlPath: path, langTo: "en" } } })).toMatchObject({ operationState: "sync_failed", lastResult: "http_503", lastHttpStatus: 503, origin: `http://${project.domain}` });
    await page.screenshot({ path: "output/playwright/url-operations-error-report.png", fullPage: true });
    const canonical = await page.request.post("/api/plugin/url-sync-result", { headers: { Authorization: `Bearer ${rawKey}` }, data: { url: `http://${project.domain}${canonicalPath}`, language: "en", state: "completed", result: "canonical_redirect_completed", httpStatus: 200 } });
    expect(canonical.status(), await canonical.text()).toBe(200);
    expect(await db.translatedUrl.findUnique({ where: { projectId_urlPath_langTo: { projectId, urlPath: canonicalPath, langTo: "en" } } })).toMatchObject({ operationState: "sync_completed", lastResult: "canonical_redirect_completed", lastHttpStatus: 200, origin: `http://${project.domain}` });
    await page.goto(`/projects/${projectId}/translations/urls?lang=en&q=${encodeURIComponent(canonicalPath)}`);
    await expect(page.getByText(canonicalPath, { exact: true })).toBeVisible();
    await expect(page.getByText("HTTP 200")).toBeVisible();
    await page.locator("article").filter({ hasText: canonicalPath }).getByRole("button", { name: "Delete" }).click();
    await expect(page.getByRole("dialog", { name: "Confirm URL action" })).toBeVisible();
    await page.getByRole("button", { name: "Confirm permanently" }).click();
    await expect(page.getByRole("status")).toContainText("URL data deleted");
  } finally {
    await db.urlCacheInvalidation.deleteMany({ where: { projectId, urlPath: path } });
    await db.urlOperationReceipt.deleteMany({ where: { projectId, urlId: url.id } });
    await db.apiKey.delete({ where: { id: key.id } });
    await db.translatedUrl.deleteMany({ where: { projectId, urlPath: { in: [path, canonicalPath] } } });
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
    const skipped = await post({ action: "delete", id: url.id, afterId: "zzzzzzzzzz" });
    expect(skipped.status()).toBe(422);
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

test("a 251-segment retranslation receipt restores its cursor and bills the final step once", async ({ page }) => {
  test.setTimeout(120_000);
  const projectId = await signInAndGetProjectId(page);
  const actorId = (await db.user.findUniqueOrThrow({ where: { email: "preview@deepglot.local" } })).id;
  const path = `/${e2eId("large-retranslate")}`;
  const url = await db.translatedUrl.create({ data: { projectId, urlPath: path, langTo: "en" } });
  const texts = Array.from({ length: 251 }, (_, index) => e2eId(`refresh${index}`));
  const hashes = texts.map((text) => computeTranslationHash(text, "de", "en"));
  const post = (data: unknown, key?: string) => page.request.post(`/api/projects/${projectId}/url-operations`, { data, headers: key ? { "Idempotency-Key": key } : {} });
  try {
    await db.translation.createMany({ data: texts.map((text, index) => ({ projectId, originalHash: hashes[index], originalText: text, translatedText: `old ${text}`, langFrom: "de", langTo: "en", source: "MOCK" })) });
    const translations = await db.translation.findMany({ where: { projectId, originalHash: { in: hashes } }, select: { id: true } });
    await db.translationContext.createMany({ data: translations.map(({ id }) => ({ translationId: id, urlPath: path })) });
    const first = await (await post({ action: "retranslate", id: url.id })).json();
    expect(first).toMatchObject({ affectedSegments: 250, remainingSegments: 1 });
    const firstData = { action: "retranslate", id: url.id, confirmation: first.confirmation };
    const before = (await db.usageRecord.aggregate({ where: { projectId }, _sum: { words: true } }))._sum.words ?? 0;
    const done = await post(firstData, first.confirmation);
    expect(done.status(), await done.text()).toBe(200);
    const firstResult = await done.json();
    expect(firstResult.nextAfterId).toBe(first.nextAfterId);
    expect(firstResult.remainingSegments).toBe(1);
    const afterFirst = (await db.usageRecord.aggregate({ where: { projectId }, _sum: { words: true } }))._sum.words ?? 0;
    expect(afterFirst - before).toBe(first.billableWords);
    await db.apiIdempotencyRecord.delete({ where: { scope_keyHash: { scope: `manager:url-operation:${projectId}:${actorId}`, keyHash: hashApiIdempotencyKey(first.confirmation) } } });
    await db.translatedUrl.update({ where: { id: url.id }, data: { operationState: "provider_pending", lastResult: "provider_outcome_unknown", operationToken: first.confirmation } });
    const recovered = await post(firstData, first.confirmation);
    expect(recovered.status(), await recovered.text()).toBe(200);
    expect(await recovered.json()).toMatchObject({ billedWords: first.billableWords, nextAfterId: first.nextAfterId, remainingSegments: 1, reconciledFromReceipt: true });
    expect((await db.usageRecord.aggregate({ where: { projectId }, _sum: { words: true } }))._sum.words).toBe(afterFirst);
    const second = await (await post({ action: "retranslate", id: url.id, afterId: first.nextAfterId })).json();
    expect(second).toMatchObject({ affectedSegments: 1, remainingSegments: 0 });
    const secondData = { action: "retranslate", id: url.id, afterId: first.nextAfterId, confirmation: second.confirmation };
    const last = await post(secondData, second.confirmation);
    expect(last.status(), await last.text()).toBe(200);
    expect((await last.json()).billedWords).toBe(second.billableWords);
    const replay = await post(secondData, second.confirmation);
    expect(replay.status()).toBe(200);
    const afterAll = (await db.usageRecord.aggregate({ where: { projectId }, _sum: { words: true } }))._sum.words ?? 0;
    expect(afterAll - before).toBe(first.billableWords + second.billableWords);
  } finally {
    await db.urlCacheInvalidation.deleteMany({ where: { projectId, urlPath: path } });
    await db.urlOperationReceipt.deleteMany({ where: { projectId, urlId: url.id } });
    await db.translation.deleteMany({ where: { projectId, originalHash: { in: hashes } } });
    await db.translatedUrl.deleteMany({ where: { id: url.id } });
    await db.$disconnect();
  }
});

test("a glossary rule committed while delete waits for its lock protects the segment", async ({ page }) => {
  test.setTimeout(120_000);
  const projectId = await signInAndGetProjectId(page);
  const path = `/${e2eId("glossary-delete")}`;
  const text = e2eId("Glossary deletion guard");
  const url = await db.translatedUrl.create({ data: { projectId, urlPath: path, langTo: "en" } });
  const translation = await db.translation.create({ data: { projectId, originalHash: computeTranslationHash(text, "de", "en"), originalText: text, translatedText: "old", langFrom: "de", langTo: "en", source: "MOCK", contexts: { create: [{ urlPath: path }] } } });
  const post = (data: unknown, key?: string) => page.request.post(`/api/projects/${projectId}/url-operations`, { data, headers: key ? { "Idempotency-Key": key } : {} });
  let ruleId: string | null = null;
  try {
    const preview = await (await post({ action: "delete", id: url.id })).json();
    let pending: ReturnType<typeof post>;
    await db.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT "id" FROM "Project" WHERE "id" = ${projectId} FOR UPDATE`;
      pending = post({ action: "delete", id: url.id, confirmation: preview.confirmation }, preview.confirmation);
      await waitForBlockedProjectLock();
      const rule = await tx.glossaryRule.create({ data: { projectId, originalTerm: text, translatedTerm: "protected", langFrom: "de", langTo: "en" } });
      ruleId = rule.id;
    }, { timeout: 15_000 });
    const result = await pending!;
    expect(result.status(), await result.text()).toBe(409);
    expect(await db.translation.findUnique({ where: { id: translation.id } })).not.toBeNull();
    expect(await db.translatedUrl.findUnique({ where: { id: url.id } })).not.toBeNull();
  } finally {
    if (ruleId) await db.glossaryRule.deleteMany({ where: { id: ruleId } });
    await db.translation.deleteMany({ where: { id: translation.id } });
    await db.translatedUrl.deleteMany({ where: { id: url.id } });
    await db.$disconnect();
  }
});

test("a glossary rule committed before dispatch prevents the provider call and usage", async ({ page }) => {
  test.setTimeout(120_000);
  const projectId = await signInAndGetProjectId(page);
  const provider = await startBarrierProvider();
  const previousSettings = await db.projectSettings.findUniqueOrThrow({ where: { projectId } });
  await db.projectSettings.update({ where: { projectId }, data: { translationProvider: "ollama", translationBaseUrl: provider.baseUrl, translationModel: "local-mock" } });
  const path = `/${e2eId("glossary-pre-dispatch")}`;
  const text = e2eId("Glossary provider guard");
  const url = await db.translatedUrl.create({ data: { projectId, urlPath: path, langTo: "en" } });
  const translation = await db.translation.create({ data: { projectId, originalHash: computeTranslationHash(text, "de", "en"), originalText: text, translatedText: "old", langFrom: "de", langTo: "en", source: "MOCK", contexts: { create: [{ urlPath: path }] } } });
  const post = (data: unknown, key?: string) => page.request.post(`/api/projects/${projectId}/url-operations`, { data, headers: key ? { "Idempotency-Key": key } : {} });
  let ruleId: string | null = null;
  try {
    const preview = await (await post({ action: "retranslate", id: url.id })).json();
    const usageBefore = (await db.usageRecord.aggregate({ where: { projectId }, _sum: { words: true } }))._sum.words;
    let pending: ReturnType<typeof post>;
    await db.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT "id" FROM "Project" WHERE "id" = ${projectId} FOR UPDATE`;
      pending = post({ action: "retranslate", id: url.id, confirmation: preview.confirmation }, preview.confirmation);
      await waitForBlockedProjectLock();
      const rule = await tx.glossaryRule.create({ data: { projectId, originalTerm: text, translatedTerm: "protected", langFrom: "de", langTo: "en" } });
      ruleId = rule.id;
    }, { timeout: 15_000 });
    const result = await pending!;
    expect(result.status(), await result.text()).toBe(409);
    expect((await db.translation.findUniqueOrThrow({ where: { id: translation.id } })).translatedText).toBe("old");
    expect((await db.usageRecord.aggregate({ where: { projectId }, _sum: { words: true } }))._sum.words).toBe(usageBefore);
    expect(provider.calls()).toBe(0);
    // The receipt/claim now takes the same project lock, so the new rule can
    // invalidate the preview before a pending provider state is ever claimed.
    expect((await db.translatedUrl.findUniqueOrThrow({ where: { id: url.id } })).operationState).toBeNull();
  } finally {
    await provider.close();
    await db.projectSettings.update({ where: { projectId }, data: { translationProvider: previousSettings.translationProvider, translationBaseUrl: previousSettings.translationBaseUrl, translationModel: previousSettings.translationModel } });
    if (ruleId) await db.glossaryRule.deleteMany({ where: { id: ruleId } });
    await db.translation.deleteMany({ where: { id: translation.id } });
    await db.translatedUrl.deleteMany({ where: { id: url.id } });
    await db.$disconnect();
  }
});

test("a glossary rule committed after a local provider starts holds the unknown outcome", async ({ page }) => {
  test.setTimeout(120_000);
  const projectId = await signInAndGetProjectId(page);
  const provider = await startBarrierProvider();
  const previousSettings = await db.projectSettings.findUniqueOrThrow({ where: { projectId } });
  await db.projectSettings.update({ where: { projectId }, data: { translationProvider: "ollama", translationBaseUrl: provider.baseUrl, translationModel: "local-mock" } });
  const path = `/${e2eId("glossary-post-dispatch")}`;
  const text = e2eId("Glossary provider started");
  const url = await db.translatedUrl.create({ data: { projectId, urlPath: path, langTo: "en" } });
  const translation = await db.translation.create({ data: { projectId, originalHash: computeTranslationHash(text, "de", "en"), originalText: text, translatedText: "old", langFrom: "de", langTo: "en", source: "MOCK", contexts: { create: [{ urlPath: path }] } } });
  const post = (data: unknown, key?: string) => page.request.post(`/api/projects/${projectId}/url-operations`, { data, headers: key ? { "Idempotency-Key": key } : {} });
  let ruleId: string | null = null;
  try {
    const preview = await (await post({ action: "retranslate", id: url.id })).json();
    const usageBefore = (await db.usageRecord.aggregate({ where: { projectId }, _sum: { words: true } }))._sum.words;
    const action = { action: "retranslate", id: url.id, confirmation: preview.confirmation };
    const pending = post(action, preview.confirmation);
    await Promise.race([provider.started, new Promise((_, reject) => setTimeout(() => reject(new Error("Provider did not start")), 15_000))]);
    expect(provider.calls()).toBe(1);
    const rule = await db.glossaryRule.create({ data: { projectId, originalTerm: text, translatedTerm: "protected", langFrom: "de", langTo: "en" } });
    ruleId = rule.id;
    provider.release();
    const result = await pending;
    expect(result.status(), await result.text()).toBe(409);
    expect((await db.translation.findUniqueOrThrow({ where: { id: translation.id } })).translatedText).toBe("old");
    expect((await db.usageRecord.aggregate({ where: { projectId }, _sum: { words: true } }))._sum.words).toBe(usageBefore);
    expect((await db.translatedUrl.findUniqueOrThrow({ where: { id: url.id } })).operationState).toBe("provider_pending");
    const replay = await post(action, preview.confirmation);
    expect(replay.status()).toBe(409);
    expect(provider.calls()).toBe(1);
  } finally {
    await provider.close();
    await db.projectSettings.update({ where: { projectId }, data: { translationProvider: previousSettings.translationProvider, translationBaseUrl: previousSettings.translationBaseUrl, translationModel: previousSettings.translationModel } });
    if (ruleId) await db.glossaryRule.deleteMany({ where: { id: ruleId } });
    await db.translation.deleteMany({ where: { id: translation.id } });
    await db.translatedUrl.deleteMany({ where: { id: url.id } });
    await db.$disconnect();
  }
});

test("manager revoked after mock provider dispatch leaves no receipt and holds the unknown outcome", async ({ page }) => {
  test.setTimeout(120_000);
  const projectId = await signInAndGetProjectId(page);
  const project = await db.project.findUniqueOrThrow({ where: { id: projectId } });
  const actor = await db.user.findUniqueOrThrow({ where: { email: "preview@deepglot.local" } });
  const membership = await db.organizationMember.findUniqueOrThrow({ where: { userId_organizationId: { userId: actor.id, organizationId: project.organizationId } } });
  const provider = await startBarrierProvider();
  const previousSettings = await db.projectSettings.findUniqueOrThrow({ where: { projectId } });
  await db.projectSettings.update({ where: { projectId }, data: { translationProvider: "ollama", translationBaseUrl: provider.baseUrl, translationModel: "local-mock" } });
  const path = `/${e2eId("manager-post-dispatch")}`;
  const text = e2eId("Manager revoked after provider starts");
  const url = await db.translatedUrl.create({ data: { projectId, urlPath: path, langTo: "en" } });
  const translation = await db.translation.create({ data: { projectId, originalHash: computeTranslationHash(text, "de", "en"), originalText: text, translatedText: "old", langFrom: "de", langTo: "en", source: "MOCK", contexts: { create: [{ urlPath: path }] } } });
  const post = (data: unknown, key?: string) => page.request.post(`/api/projects/${projectId}/url-operations`, { data, headers: key ? { "Idempotency-Key": key } : {} });
  try {
    const preview = await (await post({ action: "retranslate", id: url.id })).json();
    const usageBefore = (await db.usageRecord.aggregate({ where: { projectId }, _sum: { words: true } }))._sum.words;
    const pending = post({ action: "retranslate", id: url.id, confirmation: preview.confirmation }, preview.confirmation);
    await Promise.race([provider.started, new Promise((_, reject) => setTimeout(() => reject(new Error("Mock provider did not start")), 15_000))]);
    expect(provider.calls()).toBe(1);
    await db.organizationMember.update({ where: { id: membership.id }, data: { role: "MEMBER" } });
    provider.release();
    const result = await pending;
    expect(result.status(), await result.text()).toBe(409);
    expect((await result.json()).providerCostUnknown).toBe(true);
    expect((await db.translation.findUniqueOrThrow({ where: { id: translation.id } })).translatedText).toBe("old");
    expect((await db.usageRecord.aggregate({ where: { projectId }, _sum: { words: true } }))._sum.words).toBe(usageBefore);
    expect(await db.urlOperationReceipt.findUnique({ where: { id: preview.confirmation } })).toBeNull();
    expect((await db.translatedUrl.findUniqueOrThrow({ where: { id: url.id } })).operationState).toBe("provider_pending");
  } finally {
    provider.release();
    await provider.close();
    await db.organizationMember.update({ where: { id: membership.id }, data: { role: membership.role } });
    await db.projectSettings.update({ where: { projectId }, data: { translationProvider: previousSettings.translationProvider, translationBaseUrl: previousSettings.translationBaseUrl, translationModel: previousSettings.translationModel } });
    await db.urlOperationReceipt.deleteMany({ where: { urlId: url.id } });
    await db.translation.deleteMany({ where: { id: translation.id } });
    await db.translatedUrl.deleteMany({ where: { id: url.id } });
    await db.$disconnect();
  }
});
