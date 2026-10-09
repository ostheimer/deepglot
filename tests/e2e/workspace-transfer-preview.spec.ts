import { expect, test } from "@playwright/test";
import { randomUUID } from "node:crypto";
import { db } from "@/lib/db";
import { getTestLoginConfig } from "@/lib/test-login-config";
import { signInAsTestUser } from "./helpers";

test("transfer preview shows ownership and secret consequences before committing an isolated project", async ({ page }) => {
  await signInAsTestUser(page);
  const actor = await db.user.findUniqueOrThrow({ where: { email: getTestLoginConfig().email } });
  const source = await db.organizationMember.findFirstOrThrow({ where: { userId: actor.id }, select: { organizationId: true } });
  const suffix = randomUUID();
  const domain = `transfer-${suffix}.invalid`;
  const destination = await db.organization.create({ data: { name: `Destination ${suffix}`, slug: `destination-${suffix}`,
    plan: "STARTER", members: { create: { userId: actor.id, role: "OWNER" } },
    subscription: { create: { stripeCustomerId: `free_fixture_${suffix}`, status: "ACTIVE", plan: "STARTER", wordsLimit: 25_000 } },
  } });
  const project = await db.project.create({ data: { organizationId: source.organizationId,
    name: "Transfer UI fixture", domain, languages: { create: { langCode: "en" } },
    settings: { create: { translationProvider: "openai", translationApiKeyEncrypted: "fixture-ciphertext" } },
  } });
  try {
    await db.translation.create({ data: { projectId: project.id, originalHash: `fixture-${suffix}`,
      originalText: "Hallo", translatedText: "Hello", langFrom: "de", langTo: "en", isManual: true, source: "MANUAL" } });
    await db.apiKey.create({ data: { projectId: project.id, name: "Old plugin", key: `hash-${suffix}`, keyPrefix: "dg_fixture_" } });
    await db.webhookEndpoint.create({ data: { projectId: project.id, url: "https://example.invalid/hook",
      secret: "fixture-secret", eventTypes: ["translation.created"] } });
    await page.goto("/projects");
    const row = page.locator("div.grid").filter({ hasText: domain }).last();
    await row.getByRole("button", { name: "Transfer", exact: true }).click();
    const dialog = page.getByRole("dialog", { name: "Transfer project" });
    await dialog.getByRole("combobox", { name: "Destination workspace" }).selectOption(destination.id);
    await dialog.getByRole("button", { name: "Show transfer preview" }).click();
    await expect(dialog.getByText("Source billed words this month")).toBeVisible();
    await expect(dialog.getByText("Translations, manual edits, history, glossary, URLs, slugs and media remain with the project.", { exact: false })).toBeVisible();
    await expect(dialog.getByText("All plugin API keys are deactivated and cannot be recovered.", { exact: false })).toBeVisible();
    await expect(dialog.getByText("The source provider key is removed and fresh provider work is paused", { exact: false })).toBeVisible();
    await expect(dialog.getByText("Webhook endpoints are disabled, signing secrets removed", { exact: false })).toBeVisible();
    await expect(dialog.getByRole("button", { name: "Transfer now" })).toBeDisabled();
    await dialog.getByRole("checkbox").check();
    await dialog.getByRole("button", { name: "Transfer now" }).click();
    await expect(page.getByText("Project transferred. Reconnect the plugin and webhook credentials.")).toBeVisible();
    expect((await db.project.findUniqueOrThrow({ where: { id: project.id } })).organizationId).toBe(destination.id);
    expect((await db.projectSettings.findUniqueOrThrow({ where: { projectId: project.id } })).providerReconnectRequired).toBe(true);
    expect((await db.apiKey.findFirstOrThrow({ where: { projectId: project.id } })).isActive).toBe(false);
    expect((await db.webhookEndpoint.findFirstOrThrow({ where: { projectId: project.id } })).secret).toBe("");
    expect(await db.projectTransferAudit.count({ where: { projectId: project.id, actorUserId: actor.id } })).toBe(1);
  } finally {
    await db.project.delete({ where: { id: project.id } });
    await db.projectTransferAudit.deleteMany({ where: { projectId: project.id } });
    await db.organization.delete({ where: { id: destination.id } });
    await db.$disconnect();
  }
});
