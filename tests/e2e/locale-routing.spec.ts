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
    await expect(page.getByTitle("Deutsch")).toHaveAttribute("aria-current", "true");
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

  test("opens the WordPress plugin section from the homepage navigation", async ({
    page,
  }) => {
    await page.goto("/");

    await page.getByRole("link", { name: "WordPress Plugin" }).click();

    await expect(page).toHaveURL(/\/#plugin$/);
    await expect(page.locator("#plugin")).toBeVisible();
  });

  test("opens the WordPress plugin section from the pricing navigation", async ({
    page,
  }) => {
    await page.goto("/pricing");

    await page.getByRole("link", { name: "WordPress Plugin" }).click();

    await expect(page).toHaveURL(/\/#plugin$/);
    await expect(page.locator("#plugin")).toBeVisible();
  });

  test("uses the Deepglot logo as a home link", async ({ page }) => {
    await page.goto("/#plugin");

    await page
      .getByRole("navigation")
      .getByRole("link", { name: "Deepglot" })
      .click();

    await expect(page).toHaveURL(/\/$/);
    await expect(
      page.getByRole("heading", {
        name: /Translate your WordPress site/i,
      })
    ).toBeVisible();
  });

  test("opens public documentation and legal footer links", async ({ page }) => {
    await page.goto("/");

    await page.getByRole("link", { name: "Documentation" }).click();
    await expect(page).toHaveURL(/\/docs$/);
    await expect(
      page.getByRole("heading", { name: "Set up Deepglot" })
    ).toBeVisible();

    await page.goto("/");
    await page.getByRole("link", { name: "Privacy" }).click();
    await expect(page).toHaveURL(/\/datenschutz$/);
    await expect(page.getByRole("heading", { name: "Privacy" })).toBeVisible();

    await page.goto("/");
    await page.getByRole("link", { name: "Legal Notice" }).click();
    await expect(page).toHaveURL(/\/impressum$/);
    await expect(
      page.getByRole("heading", { name: "Legal Notice" })
    ).toBeVisible();

    await page.goto("/");
    await page.getByRole("link", { name: "Terms" }).click();
    await expect(page).toHaveURL(/\/agb$/);
    await expect(page.getByRole("heading", { name: "Terms" })).toBeVisible();
  });

  test("keeps the active anchor when switching homepage language", async ({
    page,
  }) => {
    await page.goto("/#plugin");

    await page.getByTitle("Deutsch").click();

    await expect(page).toHaveURL(/\/de#plugin$/);
    await expect(page.locator("#plugin")).toBeVisible();
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

  test("auth entry pages expose their visible title as the page h1", async ({
    page,
  }) => {
    const pages = [
      { path: "/login", heading: "Welcome back" },
      { path: "/signup", heading: "Create your account" },
      { path: "/forgot-password", heading: "Reset your password" },
      { path: "/reset-password", heading: "Choose a new password" },
      { path: "/accept-invite", heading: "Accept project invitation" },
    ];

    for (const entry of pages) {
      await page.goto(entry.path);

      await expect(
        page.getByRole("heading", { level: 1, name: entry.heading })
      ).toBeVisible();
    }
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
