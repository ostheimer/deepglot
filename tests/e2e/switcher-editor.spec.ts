import { expect, test } from "@playwright/test";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { db } from "../../src/lib/db";
import { e2eId, signInAndGetProjectId } from "./helpers";

const config = JSON.parse(readFileSync("tests/fixtures/switcher-contract.json", "utf8")).first;

test("switcher editor adopts WordPress snapshot, validates stale writes and displays runtime conflicts", async ({ page }) => {
  const seededId = await signInAndGetProjectId(page);
  const seeded = await db.project.findUniqueOrThrow({ where: { id: seededId }, select: { organizationId: true } });
  const suffix = e2eId("switcher");
  const project = await db.project.create({ data: {
    name: suffix, domain: `${suffix}.example.test`, originalLang: "de", organizationId: seeded.organizationId,
    languages: { create: { langCode: "en" } },
    settings: { create: { switcherPluginConfig: config, switcherPluginSyncedAt: new Date() } },
  } });
  const reportKey = `dg_switcher_${crypto.randomUUID()}`;
  await db.apiKey.create({ data: {
    projectId: project.id, name: "Neutral return report", key: createHash("sha256").update(reportKey).digest("hex"),
    keyPrefix: reportKey.slice(0, 12),
  } });
  const report = (owner: "saas" | "wordpress", lastSeenRevision: number) => page.request.post("/api/plugin/settings-sync", {
    headers: { authorization: `Bearer ${reportKey}` },
    data: {
      routingMode: "PATH_PREFIX", siteUrl: `https://${project.domain}`,
      sourceLanguage: "de", targetLanguages: ["en"], autoRedirect: false,
      translateEmails: false, translateSearch: false, translateAmp: false, domainMappings: [],
      switcher: { contractVersion: 1, owner, lastSeenRevision, appliedRevision: owner === "saas" ? lastSeenRevision : null,
        localConflict: false, config },
    },
  });
  try {
    await page.goto(`/projects/${project.id}/settings/switcher`);
    await expect(page.getByRole("combobox", { name: "Switcher" })).toBeEnabled();
    await expect(page.getByRole("textbox", { name: "Custom CSS" })).toHaveValue(config.instances[0].customCss);
    await page.getByRole("textbox", { name: "Custom name" }).first().fill("Deutsch aus Österreich");
    await page.getByRole("button", { name: "Move en up" }).click();
    await page.getByRole("button", { name: "Adopt in dashboard and save" }).click();
    await expect(page.getByRole("status").filter({ hasText: /WordPress will apply the changes/i })).toBeVisible();
    const saved = await db.projectSettings.findUniqueOrThrow({ where: { projectId: project.id } });
    expect(saved.switcherOwner).toBe("saas");
    expect(saved.switcherRevision).toBe(1);
    expect((saved.switcherConfig as typeof config).instances[0].languageOrder).toEqual(["en", "de"]);
    const stale = await page.request.patch(`/api/projects/${project.id}/switcher`, {
      data: { action: "save", expectedRevision: 0, expectedPluginSyncedAt: saved.switcherPluginSyncedAt?.toISOString(), config },
    });
    expect(stale.status()).toBe(409);
    await page.reload();
    await expect(page.getByRole("status").filter({ hasText: /has not confirmed/i })).toBeVisible();
    await db.projectSettings.update({ where: { projectId: project.id }, data: { switcherConflict: true, switcherPluginRevision: 1 } });
    await page.reload();
    await expect(page.getByRole("alert").filter({ hasText: /local changes/i })).toBeVisible();
    await page.getByRole("button", { name: "Return control to WordPress" }).click();
    await expect(page.getByRole("status").filter({ hasText: /manage the switcher in WordPress/i })).toBeVisible();
    const returned = await db.projectSettings.findUniqueOrThrow({ where: { projectId: project.id } });
    expect(returned.switcherOwner).toBe("wordpress");
    expect(returned.switcherPluginSyncedAt).toBeNull();
    await expect(page.getByRole("button", { name: "Adopt in dashboard and save" })).toHaveCount(0);
    const oldAdoption = await page.request.patch(`/api/projects/${project.id}/switcher`, {
      data: { action: "save", expectedRevision: returned.switcherRevision,
        expectedPluginSyncedAt: saved.switcherPluginSyncedAt?.toISOString(), config },
    });
    expect(oldAdoption.status()).toBe(409);
    await page.goto(`/de/projects/${project.id}/settings/switcher`);
    await expect(page.getByRole("combobox", { name: "Sprachauswahl" })).toHaveCount(0);
    await expect(page.getByRole("status").filter({ hasText: /noch nicht abgeglichen/i })).toBeVisible();
    expect((await report("saas", saved.switcherRevision)).status()).toBe(200);
    expect((await db.projectSettings.findUniqueOrThrow({ where: { projectId: project.id } })).switcherPluginSyncedAt).toBeNull();
    expect((await report("wordpress", returned.switcherRevision)).status()).toBe(200);
    expect((await db.projectSettings.findUniqueOrThrow({ where: { projectId: project.id } })).switcherPluginSyncedAt).not.toBeNull();
    await page.reload();
    await expect(page.getByRole("combobox", { name: "Sprachauswahl" })).toBeEnabled();
    await page.screenshot({ path: "/tmp/deepglot-262-editor-de-desktop.png", fullPage: true });
    await page.setViewportSize({ width: 390, height: 844 });
    await page.screenshot({ path: "/tmp/deepglot-262-editor-de-mobile.png", fullPage: true });
  } finally {
    await db.project.delete({ where: { id: project.id } });
  }
});

test("switcher API requires project management rights", async ({ page, request }) => {
  await signInAndGetProjectId(page);
  const session = await page.request.get("/api/auth/session");
  const userId = (await session.json()).user.id as string;
  const suffix = e2eId("switcher-access");
  const org = await db.organization.create({ data: { name: suffix, slug: suffix } });
  const project = await db.project.create({ data: {
    name: suffix, domain: `${suffix}.example.test`, organizationId: org.id,
    languages: { create: { langCode: "en" } },
    settings: { create: { switcherPluginConfig: config, switcherPluginSyncedAt: new Date() } },
  } });
  const url = `/api/projects/${project.id}/switcher`;
  const patch = { action: "save", expectedRevision: 0, expectedPluginSyncedAt: new Date().toISOString(), config };
  try {
    expect((await request.get(url)).status()).toBe(401);
    expect((await page.request.get(url)).status()).toBe(404);
    await db.projectMember.create({ data: {
      projectId: project.id, userId, email: `${suffix}@example.test`, role: "TRANSLATOR", langCode: "en",
    } });
    expect((await page.request.get(url)).status()).toBe(404);
    expect((await page.request.patch(url, { data: patch })).status()).toBe(404);
    await db.projectMember.updateMany({ where: { projectId: project.id, userId }, data: { role: "ADMIN" } });
    expect((await page.request.get(url)).status()).toBe(200);
  } finally {
    await db.organization.delete({ where: { id: org.id } });
  }
});

test("removed language overrides in a plugin report do not block sync or editing", async ({ page }) => {
  const seededId = await signInAndGetProjectId(page);
  const seeded = await db.project.findUniqueOrThrow({ where: { id: seededId }, select: { organizationId: true } });
  const suffix = e2eId("switcher-removed-language");
  const project = await db.project.create({ data: {
    name: suffix, domain: `${suffix}.example.test`, originalLang: "de", organizationId: seeded.organizationId,
    languages: { create: { langCode: "en" } },
  } });
  const rawKey = `dg_switcher_${crypto.randomUUID()}`;
  await db.apiKey.create({ data: {
    projectId: project.id, name: "Neutral switcher test", key: createHash("sha256").update(rawKey).digest("hex"),
    keyPrefix: rawKey.slice(0, 12),
  } });
  try {
    const olderConfig = structuredClone(config);
    olderConfig.instances[0].languageOrder.push("fr");
    olderConfig.instances[0].customNames.fr = "Français";
    olderConfig.instances[0].customFlags.fr = "🇫🇷";
    const response = await page.request.post("/api/plugin/settings-sync", {
      headers: { authorization: `Bearer ${rawKey}` },
      data: {
        routingMode: "PATH_PREFIX", siteUrl: `https://${project.domain}`,
        sourceLanguage: "de", targetLanguages: ["en", "fr"], autoRedirect: false,
        translateEmails: false, translateSearch: false, translateAmp: false, domainMappings: [],
        switcher: { contractVersion: 1, appliedRevision: null, localConflict: false, config: olderConfig },
      },
    });
    expect(response.status(), await response.text()).toBe(200);
    await page.goto(`/projects/${project.id}/settings/switcher`);
    await expect(page.getByRole("combobox", { name: "Switcher" })).toBeEnabled();
    await expect(page.getByRole("textbox", { name: "Custom name" })).toHaveCount(2);
    await page.getByRole("button", { name: "Adopt in dashboard and save" }).click();
    await expect(page.getByRole("status").filter({ hasText: /WordPress will apply the changes/i })).toBeVisible();
    const saved = await db.projectSettings.findUniqueOrThrow({ where: { projectId: project.id } });
    expect((saved.switcherConfig as typeof config).instances[0].customNames).toEqual({ de: "Österreichisches Deutsch", en: "English" });
  } finally {
    await db.project.delete({ where: { id: project.id } });
  }
});
