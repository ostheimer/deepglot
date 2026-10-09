import { expect, test } from "@playwright/test";
import { db } from "@/lib/db";
import { signInAsTestUser } from "./helpers";

test("owner sees independently persisted preference in English and German; revoked role cannot manage it", async ({ page }) => {
  await signInAsTestUser(page);
  const member = await db.organizationMember.findFirstOrThrow({ where: { user: { email: "preview@deepglot.local" } }, select: { userId: true, organizationId: true } });
  const organizationId = member.organizationId;
  try {
    await db.organization.update({ where: { id: organizationId }, data: { plan: "STARTER" } });
    await db.subscription.update({ where: { organizationId }, data: { plan: "STARTER", status: "ACTIVE", wordsLimit: 25000 } });
    await db.autoUpgradePreference.upsert({ where: { organizationId },
      create: { organizationId, enabled: true, maxPlan: "BUSINESS", maxPriceCents: 2500 },
      update: { enabled: true, maxPlan: "BUSINESS", maxPriceCents: 2500 } });

    await page.goto("/subscription/overview");
    await expect(page.getByRole("heading", { name: "Automatic plan upgrade" })).toBeVisible();
    await expect(page.getByLabel("Allow automatic plan upgrades")).toBeChecked();
    const readback = await page.request.get(`/api/billing/auto-upgrade?organizationId=${organizationId}`);
    expect(readback.ok()).toBeTruthy();
    expect((await readback.json()).preference.enabled).toBe(true);
    await page.goto("/de/abonnement/uebersicht");
    await expect(page.getByRole("heading", { name: "Automatische Planerhöhung" })).toBeVisible();
    await expect(page.getByLabel("Automatische Planerhöhung erlauben")).toBeChecked();
    await page.getByLabel("Automatische Planerhöhung erlauben").uncheck();
    await page.getByRole("button", { name: "Speichern" }).click();
    await expect(page.getByText("Gespeichert: deaktiviert")).toBeVisible();
    await page.reload();
    await expect(page.getByLabel("Automatische Planerhöhung erlauben")).not.toBeChecked();
    expect((await (await page.request.get(`/api/billing/auto-upgrade?organizationId=${organizationId}`)).json()).preference.enabled).toBe(false);

    await db.organizationMember.update({ where: { userId_organizationId: { userId: member.userId, organizationId } }, data: { role: "MEMBER" } });
    await page.reload();
    await expect(page.getByRole("heading", { name: "Automatische Planerhöhung" })).toHaveCount(0);
    expect((await page.request.get(`/api/billing/auto-upgrade?organizationId=${organizationId}`)).status()).toBe(403);
    expect((await page.request.put("/api/billing/auto-upgrade", { data: { organizationId, enabled: false } })).status()).toBe(403);
  } finally {
    await db.organizationMember.update({ where: { userId_organizationId: { userId: member.userId, organizationId } }, data: { role: "OWNER" } });
    await db.autoUpgradePreference.deleteMany({ where: { organizationId } });
    await db.organization.update({ where: { id: organizationId }, data: { plan: "FREE" } });
    await db.subscription.update({ where: { organizationId }, data: { plan: "FREE", status: "INACTIVE", wordsLimit: 10000 } });
  }
});
