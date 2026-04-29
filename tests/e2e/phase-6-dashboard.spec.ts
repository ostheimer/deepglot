import { expect, test } from "@playwright/test";
import { readFile } from "node:fs/promises";

import { e2eId, signInAndGetProjectId } from "./helpers";

test.describe("Phase 6 dashboard flows", () => {
  test("manages glossary rules through create, edit, and delete", async ({
    page,
  }) => {
    const projectId = await signInAndGetProjectId(page);
    const originalTerm = e2eId("E2E glossary");
    const translatedTerm = `${originalTerm} protected`;
    const editedTerm = `${originalTerm} protected edited`;

    await page.goto(`/projects/${projectId}/translations/glossary`);
    await page.getByRole("button", { name: "Add glossary rule" }).click();

    await page.getByLabel("Original term").fill(originalTerm);
    await page.getByLabel("Translated term").fill(translatedTerm);
    await page.getByLabel("Match case-sensitively").check();
    await page.getByRole("button", { name: "Save" }).click();

    await expect(page.getByText("Glossary rule saved")).toBeVisible();
    await expect(page.getByText(originalTerm, { exact: true })).toBeVisible();
    await expect(page.getByText(translatedTerm)).toBeVisible();
    await expect(page.getByText("Case-sensitive", { exact: true }).first()).toBeVisible();

    await page
      .getByRole("button", { name: `Edit glossary rule ${originalTerm}` })
      .click();
    await page.getByLabel("Translated term").fill(editedTerm);
    await page.getByRole("button", { name: "Save" }).click();

    await expect(page.getByText("Glossary rule saved")).toBeVisible();
    await expect(page.getByText(editedTerm)).toBeVisible();

    page.once("dialog", (dialog) => dialog.accept());
    await page
      .getByRole("button", { name: `Delete glossary rule ${originalTerm}` })
      .click();

    await expect(page.getByText("Glossary rule deleted")).toBeVisible();
    await expect(page.getByText(originalTerm, { exact: true })).toBeHidden();
  });

  test("imports glossary CSV and exports deterministic CSV and PO files", async ({
    page,
  }) => {
    const projectId = await signInAndGetProjectId(page);
    const importedTerm = e2eId("E2E import glossary");
    const glossaryCsv = [
      "originalTerm,translatedTerm,langFrom,langTo,caseSensitive",
      `${importedTerm},${importedTerm} protected,de,en,false`,
    ].join("\n");

    await page.goto(`/projects/${projectId}/translations/import-export`);
    await expect(
      page.getByRole("heading", { name: "Import & export" })
    ).toBeVisible();

    const glossaryCard = page.locator("section").filter({
      has: page.getByRole("heading", { name: "Glossary rules" }),
    });
    const fileChooserPromise = page.waitForEvent("filechooser");
    await glossaryCard.getByRole("button", { name: "Import" }).click();
    const fileChooser = await fileChooserPromise;
    await fileChooser.setFiles({
      name: "glossary.csv",
      mimeType: "text/csv",
      buffer: Buffer.from(glossaryCsv, "utf8"),
    });

    await expect(page.getByText("Imported 1 rows")).toBeVisible();

    const [glossaryDownload] = await Promise.all([
      page.waitForEvent("download"),
      glossaryCard.getByRole("link", { name: "Export" }).click(),
    ]);
    const glossaryPath = await glossaryDownload.path();
    expect(glossaryPath).toBeTruthy();
    const exportedGlossary = await readFile(glossaryPath!, "utf8");
    expect(exportedGlossary).toContain(
      "originalTerm,translatedTerm,langFrom,langTo,caseSensitive"
    );

    const poCard = page.locator("section").filter({
      has: page.getByRole("heading", { name: "Translations PO" }),
    });
    const [poDownload] = await Promise.all([
      page.waitForEvent("download"),
      poCard.getByRole("link", { name: "Export" }).click(),
    ]);
    const poPath = await poDownload.path();
    expect(poPath).toBeTruthy();
    const exportedPo = await readFile(poPath!, "utf8");
    expect(exportedPo).toContain('msgid ""');
    expect(exportedPo).toContain('"Language: en\\n"');

    await page.goto(`/projects/${projectId}/translations/glossary`);
    await expect(page.getByText(importedTerm, { exact: true })).toBeVisible();

    page.once("dialog", (dialog) => dialog.accept());
    await page
      .getByRole("button", { name: `Delete glossary rule ${importedTerm}` })
      .click();
    await expect(page.getByText("Glossary rule deleted")).toBeVisible();
  });

  test("renders analytics from real translation batch logs", async ({ page }) => {
    const projectId = await signInAndGetProjectId(page);

    await page.goto(`/projects/${projectId}/stats/requests`);

    await expect(
      page.getByRole("heading", { name: "Translation requests" })
    ).toBeVisible();
    await expect(
      page.getByText("Translated volume for the selected period")
    ).toBeVisible();
    await expect(page.getByText("Manual edits")).toBeVisible();
    await expect(page.getByText("Imported volume")).toBeVisible();
    await expect(page.getByText("Provider words")).toBeVisible();
    await expect(page.getByText("Language pairs")).toBeVisible();
    await expect(page.getByText("DE → EN")).toBeVisible();
    await expect(page.getByText("DE → FR")).toBeVisible();
    await expect(page.getByText("Top URLs")).toBeVisible();
    await expect(page.getByText("https://localhost:3000/preise")).toBeVisible();
  });

  test("manages webhook endpoints and records a test delivery", async ({
    page,
  }) => {
    const projectId = await signInAndGetProjectId(page);

    await page.goto(`/projects/${projectId}/settings/webhooks`);
    await page.getByRole("button", { name: "Add webhook" }).click();

    const webhookUrl = new URL(
      `/api/public/status?e2e=${e2eId("webhook")}`,
      page.url()
    ).toString();
    await page.getByLabel("URL").fill(webhookUrl);
    await page.getByRole("button", { name: "Save" }).click();

    await expect(page.getByText("Webhook saved")).toBeVisible();
    await expect(page.getByText(webhookUrl)).toBeVisible();

    let endpointCard = page
      .locator("section")
      .filter({ hasText: webhookUrl })
      .first();
    await endpointCard.getByRole("button", { name: "Send test" }).click();
    await expect(page.getByText("Test sent")).toBeVisible();

    await page.reload();
    endpointCard = page
      .locator("section")
      .filter({ hasText: webhookUrl })
      .first();
    await expect(endpointCard.getByText("Recent deliveries")).toBeVisible();
    await expect(
      endpointCard.getByText("translation.created", { exact: true }).first()
    ).toBeVisible();

    await endpointCard.getByRole("button", { name: "Rotate secret" }).click();
    await expect(page.getByText("Secret rotated")).toBeVisible();

    page.once("dialog", (dialog) => dialog.accept());
    await endpointCard.getByRole("button", { name: "Delete" }).click();
    await expect(page.getByText("Webhook deleted")).toBeVisible();
    await expect(page.getByText(webhookUrl)).toBeHidden();
  });

  test("launches a visual editor session and rejects invalid tokens", async ({
    page,
  }) => {
    const projectId = await signInAndGetProjectId(page);

    await page.goto(`/projects/${projectId}/translations/visual`);
    await expect(
      page.getByRole("heading", { name: "Visual editor" })
    ).toBeVisible();

    await page.evaluate(() => {
      const typedWindow = window as Window & {
        __deepglotOpenedUrl?: string | null;
      };
      typedWindow.__deepglotOpenedUrl = null;
      window.open = (url?: string | URL) => {
        typedWindow.__deepglotOpenedUrl = String(url);
        return null;
      };
    });

    await page.getByRole("button", { name: "Start editing" }).click();
    await expect
      .poll(() =>
        page.evaluate(() => {
          return (
            window as Window & { __deepglotOpenedUrl?: string | null }
          ).__deepglotOpenedUrl;
        })
      )
      .toContain("deepglot_editor=1");

    const launchUrl = await page.evaluate(() => {
      return (window as Window & { __deepglotOpenedUrl?: string }).__deepglotOpenedUrl;
    });
    expect(launchUrl).toBeTruthy();

    const token = new URL(launchUrl!).searchParams.get("deepglot_editor_token");
    expect(token).toBeTruthy();

    const validVerification = await page.request.get(
      `/api/projects/${projectId}/editor-sessions/verify?token=${encodeURIComponent(token!)}`
    );
    expect(validVerification.status()).toBe(200);
    await expect(validVerification).toBeOK();
    const validBody = (await validVerification.json()) as {
      ok: boolean;
      project: {
        id: string;
        originalLang: string;
        targetLanguages: string[];
      };
    };
    expect(validBody.ok).toBe(true);
    expect(validBody.project.id).toBe(projectId);
    expect(validBody.project.originalLang).toBe("de");
    expect(validBody.project.targetLanguages).toContain("en");

    const invalidVerification = await page.request.get(
      `/api/projects/${projectId}/editor-sessions/verify?token=invalid-token`
    );
    expect(invalidVerification.status()).toBe(401);
    const invalidBody = (await invalidVerification.json()) as { ok: boolean };
    expect(invalidBody.ok).toBe(false);
  });
});
