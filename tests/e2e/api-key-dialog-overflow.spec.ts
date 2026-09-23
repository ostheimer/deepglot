import { expect, test } from "@playwright/test";

// Regression guard for the "create API key" dialog overflow bug reported
// 2026-09-23: after creating a key, the green "Vollständiger API-Key" box
// (holding the full raw key, an unbroken dg_live_<64 hex> string) and the
// "Fertig" button stuck out past the dialog's right edge at desktop width.
// Renders the real CreateApiKeyDialog component via the /qa/api-key-dialog
// harness page (gated the same way as the test-login button, so it needs no
// database or authenticated session) and mocks the create-key API call.

const FAKE_RAW_KEY = `dg_live_${"a1b2c3d4".repeat(8)}`;

async function openCreatedKeyDialog(page: import("@playwright/test").Page) {
  await page.route("**/api/projects/*/api-keys", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        apiKey: { id: "qa-key-id", keyPrefix: "dg_live_a1b2", name: "QA key" },
        rawKey: FAKE_RAW_KEY,
      }),
    });
  });

  await page.goto("/qa/api-key-dialog");
  await page.getByRole("button", { name: /API-Key erstellen|Create API key/ }).first().click();

  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();
  await dialog.getByRole("button", { name: /API-Key erstellen|Create API key/ }).click();

  await expect(dialog.getByText(FAKE_RAW_KEY)).toBeVisible();
  return dialog;
}

test.describe("create API key dialog overflow (2026-09-23 bug report)", () => {
  test("raw key box and Fertig button stay inside the dialog at desktop width", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    const dialog = await openCreatedKeyDialog(page);

    const dialogBox = await dialog.boundingBox();
    const keyBox = await dialog.getByText(FAKE_RAW_KEY).boundingBox();
    const doneButton = dialog.getByRole("button", { name: /Fertig|Done/ });
    const doneBox = await doneButton.boundingBox();

    expect(dialogBox).toBeTruthy();
    expect(keyBox).toBeTruthy();
    expect(doneBox).toBeTruthy();

    // The key element itself may scroll internally, but its box must not
    // extend past the dialog's right edge.
    expect(keyBox!.x + keyBox!.width).toBeLessThanOrEqual(dialogBox!.x + dialogBox!.width + 1);
    // The Fertig/Done button must sit fully inside the dialog.
    expect(doneBox!.x).toBeGreaterThanOrEqual(dialogBox!.x - 1);
    expect(doneBox!.x + doneBox!.width).toBeLessThanOrEqual(
      dialogBox!.x + dialogBox!.width + 1
    );

    // The dialog itself must not overflow the viewport.
    const viewport = page.viewportSize();
    expect(dialogBox!.x + dialogBox!.width).toBeLessThanOrEqual(viewport!.width + 1);
  });

  test("raw key box and Fertig button stay inside the dialog at narrow (400px) width", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 400, height: 800 });
    const dialog = await openCreatedKeyDialog(page);

    const dialogBox = await dialog.boundingBox();
    const keyBox = await dialog.getByText(FAKE_RAW_KEY).boundingBox();
    const doneButton = dialog.getByRole("button", { name: /Fertig|Done/ });
    const doneBox = await doneButton.boundingBox();

    expect(dialogBox).toBeTruthy();
    expect(keyBox).toBeTruthy();
    expect(doneBox).toBeTruthy();

    expect(keyBox!.x + keyBox!.width).toBeLessThanOrEqual(dialogBox!.x + dialogBox!.width + 1);
    expect(doneBox!.x + doneBox!.width).toBeLessThanOrEqual(
      dialogBox!.x + dialogBox!.width + 1
    );

    const viewport = page.viewportSize();
    expect(dialogBox!.x + dialogBox!.width).toBeLessThanOrEqual(viewport!.width + 1);
  });
});
