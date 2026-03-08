import { expect, test, type Page } from "@playwright/test";

async function expectLocaleCookie(page: Page, locale: "en" | "de") {
  await expect
    .poll(async () => {
      const cookieString = await page.evaluate(() => document.cookie);
      const localeCookie = cookieString
        .split("; ")
        .find((cookie) => cookie.startsWith("deepglot-locale="));

      return localeCookie?.split("=")[1];
    })
    .toBe(locale);
}

test.describe("locale routing", () => {
  test("switches the marketing homepage between canonical English and German URLs", async ({
    page,
  }) => {
    await page.goto("/");

    await expect(page).toHaveURL(/\/$/);
    await expect(
      page.getByRole("heading", {
        name: /Translate your WordPress site/i,
      })
    ).toBeVisible();

    await page.getByTitle("Deutsch").click();

    await expect(page).toHaveURL(/\/de$/);
    await expect(
      page.getByRole("heading", {
        name: /Übersetze deine WordPress-Site/i,
      })
    ).toBeVisible();
    await expect(page.getByTitle("Deutsch")).toHaveAttribute("aria-pressed", "true");
    await expectLocaleCookie(page, "de");

    await page.getByTitle("English").click();

    await expect(page).toHaveURL(/\/$/);
    await expect(
      page.getByRole("heading", {
        name: /Translate your WordPress site/i,
      })
    ).toBeVisible();
    await expectLocaleCookie(page, "en");
  });

  test("keeps query parameters when switching pricing locales", async ({ page }) => {
    await page.goto("/pricing?utm=e2e");

    await expect(page).toHaveURL(/\/pricing\?utm=e2e$/);
    await expect(
      page.getByRole("heading", {
        name: "Simple, fair pricing",
      })
    ).toBeVisible();

    await page.getByTitle("Deutsch").click();

    await expect(page).toHaveURL(/\/de\/pricing\?utm=e2e$/);
    await expect(
      page.getByRole("heading", {
        name: "Einfache, faire Preise",
      })
    ).toBeVisible();
    await expectLocaleCookie(page, "de");
  });

  test("maps login and signup pages to the matching locale", async ({ page }) => {
    await page.goto("/login");

    await expect(page).toHaveURL(/\/login$/);
    await expect(
      page.getByText("Welcome back", {
        exact: true,
      })
    ).toBeVisible();

    await page.getByTitle("Deutsch").click();

    await expect(page).toHaveURL(/\/de\/login$/);
    await expect(
      page.getByText("Willkommen zurück", {
        exact: true,
      })
    ).toBeVisible();

    await page.getByRole("link", { name: "Kostenlos starten" }).click();

    await expect(page).toHaveURL(/\/de\/signup$/);
    await expect(
      page.locator("[data-slot='card-title']").filter({
        hasText: "Konto erstellen",
      })
    ).toBeVisible();
  });

  test("redirects legacy German marketing paths to canonical localized URLs", async ({
    page,
  }) => {
    await page.goto("/preise");

    await expect(page).toHaveURL(/\/de\/pricing$/);
    await expect(
      page.getByRole("heading", {
        name: "Einfache, faire Preise",
      })
    ).toBeVisible();

    await page.goto("/anmelden");

    await expect(page).toHaveURL(/\/de\/login$/);
    await expect(
      page.getByText("Willkommen zurück", {
        exact: true,
      })
    ).toBeVisible();

    await page.goto("/registrieren");

    await expect(page).toHaveURL(/\/de\/signup$/);
    await expect(
      page.locator("[data-slot='card-title']").filter({
        hasText: "Konto erstellen",
      })
    ).toBeVisible();
  });

  test("redirects protected canonical routes to locale-aware login pages", async ({
    page,
  }) => {
    await page.goto("/projects");

    await expect(page).toHaveURL(/\/login$/);
    await expect(
      page.getByText("Welcome back", {
        exact: true,
      })
    ).toBeVisible();

    await page.goto("/de/projects");

    await expect(page).toHaveURL(/\/de\/login$/);
    await expect(
      page.getByText("Willkommen zurück", {
        exact: true,
      })
    ).toBeVisible();
  });
});
