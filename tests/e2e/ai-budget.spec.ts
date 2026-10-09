import { expect, test } from "@playwright/test";
import { signInAndGetProjectId } from "./helpers";
import { db } from "@/lib/db";

test("AI budget setup is independently readable and localized before any approval", async ({ page, request }) => {
  const anonymous = await request.get("/api/projects/unknown/ai-budget");
  expect(anonymous.status()).toBe(404);
  const projectId = await signInAndGetProjectId(page);
  const readback = await page.request.get(`/api/projects/${projectId}/ai-budget`);
  expect(readback.ok()).toBeTruthy();
  const policy = await readback.json() as { organization: unknown; project: unknown; wordQuotaIsSeparate: boolean };
  expect(policy.organization).toBeNull();
  expect(policy.project).toBeNull();
  expect(policy.wordQuotaIsSeparate).toBe(true);

  await page.goto(`/projects/${projectId}/settings/language-model`);
  await expect(page.getByTestId("ai-budget-panel")).toBeVisible();
  await expect(page.getByTestId("ai-budget-readback")).toContainText("No approval. Provider calls are blocked.");
  await expect(page.getByRole("button", { name: "Explicitly approve budget" })).toBeVisible();

  await page.goto(`/de/projekte/${projectId}/einstellungen/sprachmodell`);
  await expect(page.getByTestId("ai-budget-panel")).toBeVisible();
  await expect(page.getByTestId("ai-budget-readback")).toContainText("Keine Freigabe. Anbieteraufrufe sind gesperrt.");
  await expect(page.getByRole("button", { name: "Budget ausdrücklich freigeben" })).toBeVisible();
});

test("owner can approve both scopes and read the saved policy back", async ({ page }) => {
  const projectId = await signInAndGetProjectId(page);
  const project = await db.project.findUniqueOrThrow({ where: { id: projectId }, select: { organizationId: true } });
  const initial = await db.aiBudget.findMany({ where: { organizationId: project.organizationId,
    OR: [{ projectId: null }, { projectId }] }, select: { id: true } });
  expect(initial).toHaveLength(0);
  try {
    await page.goto(`/projects/${projectId}/settings/language-model`);
    const budget = page.getByTestId("ai-budget-panel");
    for (const scope of ["Organization", "Project"]) {
      await budget.getByRole("button", { name: scope, exact: true }).click();
      await budget.getByLabel("Monthly cap").fill("1.000000");
      await budget.getByLabel("Per-call cap").fill("0.100000");
      await budget.getByRole("button", { name: "Add model" }).click();
      await budget.getByLabel("Provider", { exact: true }).selectOption("mock");
      await expect(budget.getByLabel("Provider", { exact: true })).toHaveValue("mock");
      await budget.getByLabel("Model ID").fill("mock");
      await expect(budget.getByLabel("Provider", { exact: true })).toHaveValue("mock");
      const approval = page.waitForResponse((response) => response.url().endsWith(`/api/projects/${projectId}/ai-budget`) && response.request().method() === "PUT");
      await budget.getByRole("button", { name: "Explicitly approve budget" }).click();
      const saved = await approval;
      expect(saved.request().postDataJSON()).toMatchObject({
        scope: scope.toLowerCase(), capMicros: "1000000", perCallCapMicros: "100000",
        models: [{ provider: "mock", model: "mock", unit: "ZERO_COST" }],
      });
      expect(saved.ok(), JSON.stringify(await saved.json())).toBeTruthy();
      await expect(page.getByTestId("ai-budget-panel").getByRole("status")).toContainText("Approval saved and independently read from the database.");
      await expect(page.getByTestId("ai-budget-readback")).toContainText("USD 1.000000");
    }
    const response = await page.request.get(`/api/projects/${projectId}/ai-budget`);
    expect(response.ok()).toBeTruthy();
    const readback = await response.json() as { organization: { revision: number; models: unknown[] };
      project: { revision: number; models: unknown[] } };
    expect(readback.organization.models).toHaveLength(1);
    expect(readback.project.models).toHaveLength(1);
    expect(readback.organization.revision).toBe(1);
    expect(readback.project.revision).toBe(1);
  } finally {
    // Only the two policies created in this isolated local fixture are removed.
    await db.aiBudget.deleteMany({ where: { organizationId: project.organizationId,
      OR: [{ projectId: null }, { projectId }] } });
  }
});

test("project managers can read budgets but cannot approve organization spending", async ({ page }) => {
  const projectId = await signInAndGetProjectId(page);
  const session = await (await page.request.get("/api/auth/session")).json() as { user?: { id?: string } };
  const project = await db.project.findUniqueOrThrow({ where: { id: projectId }, select: { organizationId: true } });
  const userId = session.user?.id;
  expect(userId).toBeTruthy();
  const key = { userId: userId!, organizationId: project.organizationId };
  const membership = await db.organizationMember.findUniqueOrThrow({ where: { userId_organizationId: key } });
  expect(membership.role).toBe("OWNER");
  try {
    await db.organizationMember.update({ where: { userId_organizationId: key }, data: { role: "ADMIN" } });
    const readback = await page.request.get(`/api/projects/${projectId}/ai-budget`);
    expect(readback.ok()).toBeTruthy();
    await page.goto(`/projects/${projectId}/settings/language-model`);
    await expect(page.getByTestId("ai-budget-panel")).toBeVisible();
    await expect(page.getByTestId("ai-budget-panel").getByRole("button", { name: "Explicitly approve budget" })).toHaveCount(0);
    const approval = await page.request.put(`/api/projects/${projectId}/ai-budget`, { data: {
      scope: "organization", currency: "USD", capMicros: "1000000", perCallCapMicros: "100000",
      warningPercent: 80, period: "MONTHLY_UTC", models: [{ provider: "mock", model: "mock",
        unit: "ZERO_COST", inputMicrosPerMillion: "0", outputMicrosPerMillion: "0",
        maxInputUnits: 1000, maxOutputUnits: 0, outputCapVerified: false,
        priceExpiresAt: new Date(Date.now() + 86400000).toISOString() }],
    } });
    expect(approval.status()).toBe(403);
    expect((await approval.json() as { code: string }).code).toBe("owner_required");
  } finally {
    await db.organizationMember.update({ where: { userId_organizationId: key }, data: { role: membership.role } });
  }
});
