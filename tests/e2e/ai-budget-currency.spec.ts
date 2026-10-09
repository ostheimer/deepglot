import { expect, test } from "@playwright/test";
import { randomUUID } from "node:crypto";
import { db } from "@/lib/db";
import { getTestLoginConfig } from "@/lib/test-login-config";
import { signInAsTestUser } from "./helpers";

test("budget API rejects current-month FX and inconsistent readback but permits a new period", async ({ page }) => {
  await signInAsTestUser(page);
  const actor = await db.user.findUniqueOrThrow({ where: { email: getTestLoginConfig().email } });
  const id = randomUUID();
  const organization = await db.organization.create({ data: { name: "Currency API fixture",
    slug: `currency-api-${id}`, members: { create: { userId: actor.id, role: "OWNER" } } } });
  const project = await db.project.create({ data: { organizationId: organization.id,
    name: "Currency API", domain: `currency-api-${id}.invalid` } });
  const endpoint = `/api/projects/${project.id}/ai-budget`;
  const policy = (scope: "organization" | "project", currency: string) => ({
    scope, currency, capMicros: "10000", perCallCapMicros: "5000", warningPercent: 80,
    period: "MONTHLY_UTC", models: [{ provider: "mock", model: "mock", unit: "ZERO_COST",
      inputMicrosPerMillion: "0", outputMicrosPerMillion: "0", maxInputUnits: 10000,
      maxOutputUnits: 0, outputCapVerified: true,
      priceExpiresAt: new Date(Date.now() + 86400000).toISOString() }],
  });
  const now = new Date();
  const periodKey = now.getUTCFullYear() * 100 + now.getUTCMonth() + 1;
  const previousMonth = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1));
  const previousPeriodKey = previousMonth.getUTCFullYear() * 100 + previousMonth.getUTCMonth() + 1;
  try {
    for (const scope of ["organization", "project"] as const) {
      expect((await page.request.put(endpoint, { data: policy(scope, "USD") })).status()).toBe(200);
    }
    const reservation = await db.aiSpendReservation.create({ data: {
      organizationId: organization.id, projectId: project.id,
      requestKeyHash: `api-currency-${id}`, requestGroupHash: `api-currency-group-${id}`,
      dispatchId: id, actorKind: "USER", actorId: actor.id, action: "TRANSLATION",
      provider: "openai", model: "fixture", currency: "USD", periodKey,
      state: "UNKNOWN", reservedMicros: BigInt(4000), estimatedInputUnits: 1000,
      maxOutputUnits: 100, unit: "TOKEN",
      orgInputMicrosPerMillion: BigInt(1000000), orgOutputMicrosPerMillion: BigInt(1000000),
      projectInputMicrosPerMillion: BigInt(1000000), projectOutputMicrosPerMillion: BigInt(1000000),
    } });
    for (const scope of ["organization", "project"] as const) {
      const response = await page.request.put(endpoint, { data: policy(scope, "EUR") });
      expect(response.status()).toBe(409);
      expect((await response.json()).code).toBe("budget_currency_conflict");
    }
    expect(await db.aiBudget.count({ where: { organizationId: organization.id, currency: "USD" } })).toBe(2);
    // A legacy/manual inconsistency must not be displayed as precise EUR headroom.
    await db.aiBudget.updateMany({ where: { organizationId: organization.id }, data: { currency: "EUR" } });
    const readback = await page.request.get(endpoint);
    expect(readback.status()).toBe(409);
    expect((await readback.json()).code).toBe("budget_currency_conflict");
    const estimate = await page.request.post(endpoint, { data: {
      action: "TRANSLATION", provider: "mock", model: "mock", inputUnits: 1, outputUnits: 0,
    } });
    expect(estimate.status()).toBe(409);
    expect((await estimate.json()).code).toBe("budget_currency_conflict");
    await db.aiBudget.updateMany({ where: { organizationId: organization.id }, data: { currency: "USD" } });
    await db.aiSpendReservation.update({ where: { id: reservation.id }, data: { periodKey: previousPeriodKey } });
    for (const scope of ["organization", "project"] as const) {
      expect((await page.request.put(endpoint, { data: policy(scope, "EUR") })).status()).toBe(200);
    }
    expect((await db.aiSpendReservation.findUniqueOrThrow({ where: { id: reservation.id } })).currency).toBe("USD");
    const newPeriodEstimate = await page.request.post(endpoint, { data: {
      action: "TRANSLATION", provider: "mock", model: "mock", inputUnits: 1, outputUnits: 0,
    } });
    expect(newPeriodEstimate.status()).toBe(200);
    expect((await newPeriodEstimate.json()).currency).toBe("EUR");
  } finally {
    await db.organization.delete({ where: { id: organization.id } });
  }
});
