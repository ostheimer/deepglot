import { expect, test } from "@playwright/test";
import { db } from "../../src/lib/db";
import { PDFDocument, StandardFonts } from "pdf-lib";
import { e2eId, signInAndGetProjectId } from "./helpers";

test("workspace previews selected replacement and runs mock AI only after a second click", async ({ page }) => {
  const projectId = await signInAndGetProjectId(page);
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
    await page.getByRole("button", { name: "Run AI now" }).click();
    await expect(page.getByRole("button", { name: "Use suggestion in editor" })).toBeVisible();
    expect((await db.translation.findUniqueOrThrow({ where: { id: row.id } })).translatedText).toBe("Hi {name}");
    const sourcePdf = await PDFDocument.create();
    const font = await sourcePdf.embedFont(StandardFonts.Helvetica);
    sourcePdf.addPage([595, 842]).drawText("Hallo PDF", { x: 48, y: 780, font, size: 12 });
    const bytes = await sourcePdf.save();
    await page.goto(`/projects/${projectId}/translations/pdf`);
    await page.locator('input[type="file"]').setInputFiles({ name: "fixture.pdf",
      mimeType: "application/pdf", buffer: Buffer.from(bytes) });
    await page.getByRole("button", { name: "Preview cost and quota" }).click();
    await expect(page.getByRole("status")).toContainText("Approved for this preview");
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
