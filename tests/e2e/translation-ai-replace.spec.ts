import { expect, test } from "@playwright/test";
import { db } from "../../src/lib/db";
import { PDFDocument, StandardFonts } from "pdf-lib";
import { createServer } from "node:http";
import { once } from "node:events";
import { hashRateLimitSubject, TRANSLATE_WORD_VELOCITY_SCOPE } from "@/lib/rate-limit";
import { e2eId, signInAndGetProjectId } from "./helpers";

test("workspace replacement saves and default-off AI preview pauses provider work", async ({ page }) => {
  const projectId = await signInAndGetProjectId(page);
  const aiRunRequests: string[] = [];
  page.on("request", (request) => {
    if (request.url().endsWith("/ai-suggestion") && request.postDataJSON()?.mode === "run")
      aiRunRequests.push(request.url());
  });
  const marker = e2eId("Workspace AI");
  const row = await db.translation.create({ data: {
    projectId, originalHash: marker, originalText: `${marker} Hallo {name}`,
    translatedText: "Hello {name}", langFrom: "de", langTo: "en", source: "MOCK",
    typeObservations: { create: { wordType: 1 } },
  } });
  const settings = await db.projectSettings.findUnique({ where: { projectId } });
  const project = await db.project.findUniqueOrThrow({ where: { id: projectId },
    include: { organization: { include: { members: true } } } });
  const ownerId = project.organization.members.find((member) => member.role === "OWNER")?.userId;
  expect(ownerId).toBeTruthy();
  const createdBudgetIds: string[] = [];
  try {
    for (const scopeProjectId of [null, projectId]) {
      const policy = await db.aiBudget.create({ data: {
        organizationId: project.organizationId, projectId: scopeProjectId,
        currency: "USD", capMicros: BigInt(1_000_000), perCallCapMicros: BigInt(1_000_000),
        warningPercent: 80, period: "MONTHLY_UTC", approvedByUserId: ownerId!,
        models: { create: { provider: "mock", model: "mock", unit: "ZERO_COST",
          inputMicrosPerMillion: BigInt(0), outputMicrosPerMillion: BigInt(0),
          maxInputUnits: 100_000, maxOutputUnits: 100,
          priceExpiresAt: new Date(Date.now() + 86_400_000) } },
      } });
      createdBudgetIds.push(policy.id);
    }
    await db.projectSettings.upsert({ where: { projectId },
      create: { projectId, translationProvider: "mock" },
      update: { translationProvider: "mock" } });
    await page.goto(`/projects/${projectId}/translations/pros`);
    await page.getByPlaceholder("Search text...").fill(marker);
    await page.getByRole("button", { name: "Search", exact: true }).click();
    await expect(page.locator("article")).toHaveCount(1);
    await page.getByLabel("Saved variable check", { exact: true }).selectOption("all_match");
    await expect(page.locator("article")).toHaveCount(1);
    await page.getByRole("checkbox", { name: "Select visible segments" }).check();
    await page.getByLabel("Find literal text").fill("Hello");
    await page.getByLabel("Replace with").fill("Hi");
    await page.getByRole("button", { name: "Preview replacements" }).click();
    await expect(page.getByLabel("Replacement preview")).toContainText("Hi {name}");
    expect((await db.translation.findUniqueOrThrow({ where: { id: row.id } })).translatedText).toBe("Hello {name}");
    await page.getByRole("button", { name: "Save previewed replacements" }).click();
    await expect(page.getByRole("status")).toContainText("Selected replacements were saved.");
    expect((await db.translation.findUniqueOrThrow({ where: { id: row.id } })).translatedText).toBe("Hi {name}");
    await page.locator("article").getByRole("button", { name: "Edit", exact: true }).click();
    await page.getByRole("button", { name: "Check provider and quota" }).click();
    await expect(page.getByText(/mock · 9 input characters/)).toBeVisible();
    await expect(page.getByText("Budget enforcement is inactive. This is a read-only estimate; AI Run is paused.")).toBeVisible();
    await expect(page.getByRole("button", { name: "Run AI now" })).toBeDisabled();
    expect(aiRunRequests).toHaveLength(0);
    expect(await db.aiSpendReservation.count({ where: { projectId, action: "AI_EDIT" } })).toBe(0);
    expect((await db.translation.findUniqueOrThrow({ where: { id: row.id } })).translatedText).toBe("Hi {name}");
    const sourcePdf = await PDFDocument.create();
    const font = await sourcePdf.embedFont(StandardFonts.Helvetica);
    sourcePdf.addPage([595, 842]).drawText("Hallo PDF", { x: 48, y: 780, font, size: 12 });
    const bytes = await sourcePdf.save();
    await page.goto(`/projects/${projectId}/translations/pdf`);
    await page.locator('input[type="file"]').setInputFiles({ name: "fixture.pdf",
      mimeType: "application/pdf", buffer: Buffer.from(bytes) });
    await page.getByRole("button", { name: "Preview cost and quota" }).click();
    await expect(page.getByRole("status")).toContainText("Budget enforcement is off: estimate only.");
    const download = page.waitForEvent("download");
    await page.getByRole("button", { name: "Translate and download" }).click();
    expect((await download).suggestedFilename()).toContain("deepglot-en.pdf");
  } finally {
    await db.translation.deleteMany({ where: { id: row.id } });
    if (settings) await db.projectSettings.update({ where: { projectId },
      data: { translationProvider: settings.translationProvider } });
    await db.aiBudget.deleteMany({ where: { id: { in: createdBudgetIds } } });
    await db.$disconnect();
  }
});

test("active AI editor previews, runs one local provider call, then saves suggestion with CAS", async ({ page }) => {
  test.skip(process.env.AI_BUDGET_ENFORCEMENT !== "on", "isolated active-budget browser contract");
  const seededProjectId = await signInAndGetProjectId(page);
  const seeded = await db.project.findUniqueOrThrow({ where: { id: seededProjectId },
    include: { organization: { include: { members: true } } } });
  const ownerId = seeded.organization.members.find((member) => member.role === "OWNER")?.userId;
  expect(ownerId).toBeTruthy();
  const suffix = crypto.randomUUID();
  let providerCalls = 0;
  const provider = createServer((_request, response) => {
    providerCalls += 1;
    response.writeHead(200, { "Content-Type": "application/json" });
    response.end(JSON.stringify({ choices: [{ message: { content: JSON.stringify({
      translations: [{ text: "Polished Hello {name}" }],
    }) } }], usage: { prompt_tokens: 1, completion_tokens: 1 } }));
  });
  provider.listen(0, "127.0.0.1");
  await once(provider, "listening");
  const address = provider.address();
  expect(address && typeof address !== "string").toBeTruthy();
  const organization = await db.organization.create({ data: { name: `AI browser ${suffix}`,
    slug: `ai-browser-${suffix}`, members: { create: { userId: ownerId!, role: "OWNER" } } } });
  const project = await db.project.create({ data: { organizationId: organization.id,
    name: "AI browser fixture", domain: `ai-browser-${suffix}.invalid`, originalLang: "de",
    languages: { create: { langCode: "en" } }, settings: { create: {
      translationProvider: "openai-compatible", translationModel: "fixture",
      translationBaseUrl: `http://127.0.0.1:${(address as { port: number }).port}/v1`,
    } } } });
  const row = await db.translation.create({ data: { projectId: project.id,
    originalHash: `ai-browser-${suffix}`, originalText: `Hallo {name} ${suffix}`,
    translatedText: "Hello {name}", langFrom: "de", langTo: "en", source: "MOCK",
    typeObservations: { create: { wordType: 1 } },
  } });
  try {
    for (const projectId of [null, project.id]) await db.aiBudget.create({ data: {
      organizationId: organization.id, projectId, currency: "USD", capMicros: BigInt(1_000_000),
      perCallCapMicros: BigInt(1_000_000), warningPercent: 80, period: "MONTHLY_UTC",
      approvedByUserId: ownerId!, models: { create: { provider: "openai-compatible",
        model: "fixture", unit: "TOKEN", inputMicrosPerMillion: BigInt(0),
        outputMicrosPerMillion: BigInt(0), maxInputUnits: 100_000, maxOutputUnits: 100,
        outputCapVerified: true, priceExpiresAt: new Date(Date.now() + 86_400_000) } },
    } });
    await page.goto(`/projects/${project.id}/translations/pros`);
    await page.getByPlaceholder("Search text...").fill(suffix);
    await page.getByRole("button", { name: "Search", exact: true }).click();
    await expect(page.locator("article")).toHaveCount(1);
    await page.locator("article").getByRole("button", { name: "Edit", exact: true }).click();
    await page.getByRole("button", { name: "Check provider and quota" }).click();
    await expect(page.getByText(/openai-compatible · fixture/)).toBeVisible();
    await expect(page.getByRole("button", { name: "Run AI now" })).toBeEnabled();
    await page.getByRole("button", { name: "Run AI now" }).click();
    await expect(page.getByRole("button", { name: "Use suggestion in editor" })).toBeVisible();
    expect(providerCalls).toBe(1);
    expect((await db.translation.findUniqueOrThrow({ where: { id: row.id } })).translatedText).toBe("Hello {name}");
    await page.getByRole("button", { name: "Use suggestion in editor" }).click();
    await expect(page.getByLabel("Translation", { exact: true })).toHaveValue("Polished Hello {name}");
    await page.locator("article").getByRole("button", { name: "Save", exact: true }).click();
    await expect.poll(async () => (await db.translation.findUniqueOrThrow({ where: { id: row.id } })).translatedText)
      .toBe("Polished Hello {name}");
    expect((await db.translation.findUniqueOrThrow({ where: { id: row.id } })).isManual).toBe(true);
    expect(await db.translationContentRevision.count({ where: { translationId: row.id } })).toBe(1);
    const receipts = await db.aiSpendReservation.findMany({ where: { projectId: project.id } });
    expect(receipts).toHaveLength(1);
    expect(receipts[0].state).toBe("SETTLED");
    expect(providerCalls).toBe(1);
  } finally {
    await db.apiIdempotencyRecord.deleteMany({ where: { scope: { startsWith: `workspace-ai:${project.id}:` } } });
    await db.aiBudgetEvent.deleteMany({ where: { organizationId: organization.id } });
    await db.rateLimitBucket.deleteMany({ where: { scope: TRANSLATE_WORD_VELOCITY_SCOPE,
      subjectHash: hashRateLimitSubject(TRANSLATE_WORD_VELOCITY_SCOPE, organization.id) } });
    await db.organization.delete({ where: { id: organization.id } });
    provider.closeAllConnections();
    provider.close();
    await once(provider, "close");
    await db.$disconnect();
  }
});
