import { expect, test } from "@playwright/test";
import { signInAndGetProjectId, e2eId } from "./helpers";
import { db } from "../../src/lib/db";

test("quality and observation filters compose and refresh after a content correction", async ({
  page,
}) => {
  const projectId = await signInAndGetProjectId(page);
  const marker = e2eId("Quality");
  const ids: string[] = [];
  try {
    for (const [index, translatedText] of [
      "Missing",
      "Hello {{name}}",
      "Unknown",
    ].entries()) {
      const row = await db.translation.create({
        data: {
          projectId,
          originalHash: `${marker}-${index}`,
          originalText: `${marker}-${index} {{name}}`,
          translatedText,
          langFrom: "de",
          langTo: "en",
          source: "MOCK",
          ...(index < 2
            ? {
                metadata: {
                  create: { variables: ["{{name}}"], labels: ["quality-test"] },
                },
                contexts: {
                  create: {
                    urlPath: "/quality",
                    lastSeenAt: new Date(
                      Date.now() - (index === 0 ? 40 : 0) * 86_400_000,
                    ),
                  },
                },
              }
            : {}),
        },
      });
      ids.push(row.id);
    }
    await page.goto(`/projects/${projectId}/translations/pros`);
    await page.getByPlaceholder("Search text...").fill(marker);
    await page.getByRole("button", { name: "Search", exact: true }).click();
    await expect(page.locator("article")).toHaveCount(3);
    await page
      .getByLabel("Saved variable check", { exact: true })
      .selectOption("mismatch");
    await page
      .getByLabel("Observed activity", { exact: true })
      .selectOption("older");
    await expect(page.locator("article")).toHaveCount(1);
    await expect(page.locator("article")).toContainText(`${marker}-0`);
    await expect(
      page.getByText("Checks cover selected variables only.", { exact: false }),
    ).toBeVisible();
    const row = page.locator("article");
    await row.getByRole("button", { name: "Edit", exact: true }).click();
    await row.getByRole("textbox").fill("Corrected {{name}}");
    await row.getByRole("button", { name: "Save", exact: true }).click();
    await expect(page.locator("article")).toHaveCount(0);
    await page
      .getByLabel("Saved variable check", { exact: true })
      .selectOption("match");
    await expect(page.locator("article")).toHaveCount(1);
    await expect(page.locator("article")).toContainText("Corrected {{name}}");
    await page
      .getByLabel("Observed activity", { exact: true })
      .selectOption("recent");
    await expect(page.locator("article")).toHaveCount(1);
    await expect(page.locator("article")).toContainText(`${marker}-1`);
    await page
      .getByRole("button", { name: "Reset filters", exact: true })
      .click();
    await expect(
      page.getByLabel("Saved variable check", { exact: true }),
    ).toHaveValue("");
    await expect(
      page.getByLabel("Observed activity", { exact: true }),
    ).toHaveValue("");
    await page.getByPlaceholder("Search text...").fill(marker);
    await page.getByRole("button", { name: "Search", exact: true }).click();
    await page
      .getByLabel("Observed activity", { exact: true })
      .selectOption("unknown");
    await page
      .getByLabel("Saved variable check", { exact: true })
      .selectOption("unchecked");
    await expect(page.locator("article")).toHaveCount(1);
    await expect(page.locator("article")).toContainText(`${marker}-2`);
    for (const query of [
      "quality=bogus",
      "activity=inactive",
      "quality=match&activity=bogus",
    ]) {
      expect(
        (
          await page.request.get(
            `/api/projects/${projectId}/translations?${query}`,
          )
        ).status(),
      ).toBe(400);
    }
  } finally {
    await db.translation.deleteMany({ where: { projectId, id: { in: ids } } });
    await db.$disconnect();
  }
});
