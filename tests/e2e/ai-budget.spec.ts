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

test("owner can release an UNKNOWN hold only through explicit verified review", async ({ page }) => {
  const projectId = await signInAndGetProjectId(page);
  const session = await (await page.request.get("/api/auth/session")).json() as { user?: { id?: string } };
  const project = await db.project.findUniqueOrThrow({ where: { id: projectId }, select: { organizationId: true } });
  const budget = await db.aiBudget.create({ data: { organizationId: project.organizationId,
    projectId, currency: "USD", capMicros: BigInt(1000000), perCallCapMicros: BigInt(100000),
    warningPercent: 80, period: "MONTHLY_UTC", approvedByUserId: session.user!.id! } });
  const reservation = await db.aiSpendReservation.create({ data: {
    organizationId: project.organizationId, projectId, requestKeyHash: `fixture-${budget.id}`,
    requestGroupHash: `fixture-group-${budget.id}`, dispatchId: budget.id,
    actorKind: "USER", actorId: session.user!.id!, action: "TRANSLATION",
    provider: "mock", model: "mock", currency: "USD", periodKey: 202610, state: "UNKNOWN",
    reservedMicros: BigInt(100), estimatedInputUnits: 100, maxOutputUnits: 10,
    orgInputMicrosPerMillion: BigInt(1000000), orgOutputMicrosPerMillion: BigInt(1000000),
    projectInputMicrosPerMillion: BigInt(1000000), projectOutputMicrosPerMillion: BigInt(1000000), unit: "TOKEN",
  } });
  try {
    await page.goto(`/projects/${projectId}/settings/language-model`);
    const panel = page.getByTestId("ai-budget-panel");
    await expect(panel.getByText("Review unknown usage manually")).toBeVisible();
    await panel.getByLabel("Reservation").selectOption(reservation.id);
    await panel.getByLabel("Verified outcome").selectOption("VERIFIED_NO_CHARGE");
    await panel.getByLabel("Receipt or credit ID").fill("credit-fixture-319");
    await panel.getByRole("button", { name: "Record verified resolution" }).click();
    await expect(panel.getByRole("status")).toContainText("Manual review recorded and budget balance read again.");
    const saved = await db.aiSpendReservation.findUniqueOrThrow({ where: { id: reservation.id } });
    expect(saved.state).toBe("SETTLED");
    expect(saved.reconciledCeilingMicros).toBe(BigInt(0));
    expect(saved.actualInputUnits).toBeNull();
    expect(saved.actualOutputUnits).toBeNull();
    expect(saved.resolutionEvidenceHash).toHaveLength(64);
  } finally {
    await db.aiBudgetEvent.deleteMany({ where: { budgetId: budget.id } });
    await db.aiSpendReservation.delete({ where: { id: reservation.id } });
    await db.aiBudget.delete({ where: { id: budget.id } });
  }
});

test("current-period budget threshold is delivered in both dashboard locales only to managers", async ({ page }) => {
  const projectId = await signInAndGetProjectId(page);
  const session = await (await page.request.get("/api/auth/session")).json() as { user?: { id?: string } };
  const project = await db.project.findUniqueOrThrow({ where: { id: projectId }, select: { organizationId: true } });
  const key = { userId: session.user!.id!, organizationId: project.organizationId };
  const membership = await db.organizationMember.findUniqueOrThrow({ where: { userId_organizationId: key } });
  const periodKey = new Date().getUTCFullYear() * 100 + new Date().getUTCMonth() + 1;
  const budget = await db.aiBudget.create({ data: { organizationId: project.organizationId,
    currency: "USD", capMicros: BigInt(1000000), perCallCapMicros: BigInt(1000000),
    warningPercent: 80, period: "MONTHLY_UTC", approvedByUserId: key.userId } });
  const reservation = await db.aiSpendReservation.create({ data: {
    organizationId: project.organizationId, projectId, requestKeyHash: `alert-${budget.id}`,
    requestGroupHash: `alert-group-${budget.id}`, dispatchId: budget.id,
    actorKind: "USER", actorId: key.userId, action: "TRANSLATION",
    provider: "mock", model: "mock", currency: "USD", periodKey, state: "SETTLED",
    reservedMicros: BigInt(800000), reconciledCeilingMicros: BigInt(800000),
    estimatedInputUnits: 1, maxOutputUnits: 0, orgInputMicrosPerMillion: BigInt(0),
    orgOutputMicrosPerMillion: BigInt(0), projectInputMicrosPerMillion: BigInt(0),
    projectOutputMicrosPerMillion: BigInt(0), unit: "TOKEN",
  } });
  const event = await db.aiBudgetEvent.create({ data: { organizationId: project.organizationId,
    budgetId: budget.id, kind: "WARNING_REACHED", periodKey, threshold: 80 } });
  try {
    await page.goto("/dashboard");
    const english = page.getByRole("region", { name: "AI budget alerts" });
    await expect(english).toContainText("Warning threshold reached");
    await expect(english).toContainText("USD 0.800000/1.000000");
    await page.goto("/de/dashboard");
    const german = page.getByRole("region", { name: "KI-Budgetwarnungen" });
    await expect(german).toContainText("Warnschwelle erreicht");
    await expect(german).toContainText("USD 0.800000/1.000000");
    await db.organizationMember.update({ where: { userId_organizationId: key }, data: { role: "MEMBER" } });
    await page.reload();
    await expect(page.getByRole("region", { name: "KI-Budgetwarnungen" })).toHaveCount(0);
  } finally {
    await db.organizationMember.update({ where: { userId_organizationId: key }, data: { role: membership.role } });
    await db.aiBudgetEvent.delete({ where: { id: event.id } });
    await db.aiSpendReservation.delete({ where: { id: reservation.id } });
    await db.aiBudget.delete({ where: { id: budget.id } });
  }
});
