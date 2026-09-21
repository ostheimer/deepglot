import { expect, test } from "@playwright/test";
import { signInAndGetProjectId, e2eId } from "./helpers";
import { db } from "../../src/lib/db";

test("persists labels notes and selected variables and reloads metadata filters", async ({
  page,
}) => {
  const projectId = await signInAndGetProjectId(page);
  const originalText = e2eId("Metadaten {{name}}");
  const segment = await db.translation.create({
    data: {
      projectId,
      originalHash: originalText,
      originalText,
      translatedText: "Hello {{name}}",
      langFrom: "de",
      langTo: "en",
      source: "MOCK",
    },
  });
  try {
    await page.goto(`/projects/${projectId}/translations/pros`);
    await page.getByPlaceholder("Search text...").fill(originalText);
    await page.getByRole("button", { name: "Search", exact: true }).click();
    const row = page.locator("article").filter({ hasText: originalText });
    await row.getByText("Labels and variables", { exact: true }).click();
    await row
      .getByRole("button", { name: "Edit metadata", exact: true })
      .click();
    await row.getByLabel("Labels (one per line)").fill("QA\nPrüfen");
    await row.getByLabel("Notes", { exact: true }).fill("Review note");
    await row.getByRole("checkbox", { name: "{{name}}", exact: true }).check();
    await row.getByRole("button", { name: "Save", exact: true }).click();
    await expect(row).toContainText("Review note");
    await page.reload();
    await page.getByLabel("Label filter").fill("QA");
    await page.getByRole("button", { name: "Search", exact: true }).click();
    await page
      .getByLabel("Saved variables", { exact: true })
      .selectOption("saved");
    await expect(row).toHaveCount(1);
    await row.getByText("Labels and variables", { exact: true }).click();
    await expect(row).toContainText("Review note");
    await row
      .getByRole("button", { name: "Edit metadata", exact: true })
      .click();
    await row.getByLabel("Labels (one per line)").fill("Done");
    await row.getByRole("button", { name: "Save", exact: true }).click();
    await expect(row).toHaveCount(0);
    const stale = await page.request.patch(
      `/api/projects/${projectId}/translations/${segment.id}`,
      {
        data: {
          metadata: { labels: [], variables: [], note: "stale" },
          expectedVersion: 0,
        },
      },
    );
    expect(stale.status()).toBe(409);
    const invalid = await page.request.patch(
      `/api/projects/${projectId}/translations/${segment.id}`,
      {
        data: {
          metadata: { labels: [], variables: ["{{other}}"], note: "" },
          expectedVersion: 2,
        },
      },
    );
    expect(invalid.status()).toBe(400);
    const current = await db.translation.findUniqueOrThrow({
      where: { id: segment.id },
      include: { metadata: true },
    });
    expect(current.translatedText).toBe(segment.translatedText);
    expect(current.updatedAt).toEqual(segment.updatedAt);
    expect(current.metadata?.labels).toEqual(["done"]);
  } finally {
    await db.translation.delete({ where: { id: segment.id } });
    await db.$disconnect();
  }
});
