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

async function switchMarketingLanguage(page: Page, languageName: string) {
  await page.getByRole("button", { name: "Language" }).click();
  await page.getByRole("menuitem", { name: new RegExp(languageName, "i") }).click();
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

    await switchMarketingLanguage(page, "Deutsch");

    await expect(page).toHaveURL(/\/de$/);
    await expect(
      page.getByRole("heading", {
        name: /Übersetze deine WordPress-Site/i,
      })
    ).toBeVisible();
    await page.getByRole("button", { name: "Language" }).click();
    await expect(page.getByRole("menuitem", { name: /Deutsch/i })).toHaveAttribute("aria-current", "true");
    await page.keyboard.press("Escape");
    await expectLocaleCookie(page, "de");

    await switchMarketingLanguage(page, "English");

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
    await expect(page).toHaveURL(/\/privacy$/);
    await expect(page.getByRole("heading", { name: "Privacy" })).toBeVisible();

    await page.goto("/");
    await page.getByRole("link", { name: "Legal Notice" }).click();
    await expect(page).toHaveURL(/\/legal-notice$/);
    await expect(
      page.getByRole("heading", { name: "Legal Notice" })
    ).toBeVisible();

    await page.goto("/");
    await page.getByRole("link", { name: "Terms" }).click();
    await expect(page).toHaveURL(/\/terms$/);
    await expect(page.getByRole("heading", { name: "Terms" })).toBeVisible();
  });

  test("keeps the active anchor when switching homepage language", async ({
    page,
  }) => {
    await page.goto("/#plugin");

    await switchMarketingLanguage(page, "Deutsch");

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

    await switchMarketingLanguage(page, "Deutsch");

    await expect(page).toHaveURL(/\/de\/preise\?utm=e2e$/);
    await expect(
      page.getByRole("heading", {
        name: "Einfache, faire Preise",
      })
    ).toBeVisible();
    await expectLocaleCookie(page, "de");
  });

  test("localizes Bulgarian marketing pricing units", async ({ page }) => {
    await page.goto("/bg");

    await expect(page.getByText("EUR 69/month", { exact: true })).toHaveCount(0);
    await expect(page.getByText("200k words", { exact: true })).toHaveCount(0);
    await expect(page.getByText(/EUR 69\/месец/)).toBeVisible();
    await expect(page.getByText(/200\s+хил\.\s+думи/)).toHaveCount(2);
  });

  test("localizes marketing metadata and legal page titles", async ({
    page,
    request,
  }) => {
    const hydrationErrors: string[] = [];
    page.on("console", (message) => {
      if (message.type() === "error") {
        const text = message.text();
        if (text.includes("hydration") || text.includes("React error #418")) {
          hydrationErrors.push(text);
        }
      }
    });

    await page.goto("/hr/dokumentacija");

    await expect(page).toHaveTitle(/Dokumentacija \| Deepglot/);

    await page.goto("/es/terminos");

    const response = await request.get("/es/terminos");
    const html = await response.text();
    expect(html).toContain(">ES<");
    expect(html).toContain('rel="canonical" href="https://deepglot.ai/es/terminos"');

    await expect(
      page.getByRole("heading", { level: 1, name: "Términos" })
    ).toBeVisible();
    await expect(page).toHaveTitle(/Términos \| Deepglot/);
    await expect(page.getByRole("button", { name: "Language" })).toContainText("ES");
    expect(hydrationErrors).toEqual([]);
  });

  test("maps login and signup pages to the matching locale", async ({ page }) => {
    await page.goto("/login");

    await expect(page).toHaveURL(/\/login$/);
    await expect(
      page.getByText("Welcome back", {
        exact: true,
      })
    ).toBeVisible();

    await switchMarketingLanguage(page, "Deutsch");

    await expect(page).toHaveURL(/\/de\/anmelden$/);
    await expect(
      page.getByText("Willkommen zurück", {
        exact: true,
      })
    ).toBeVisible();

    await page.getByRole("link", { name: "Kostenlos starten" }).click();

    await expect(page).toHaveURL(/\/de\/registrieren$/);
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

    await expect(page).toHaveURL(/\/de\/preise$/);
    await expect(
      page.getByRole("heading", {
        name: "Einfache, faire Preise",
      })
    ).toBeVisible();

    await page.goto("/anmelden");

    await expect(page).toHaveURL(/\/de\/anmelden$/);
    await expect(
      page.getByText("Willkommen zurück", {
        exact: true,
      })
    ).toBeVisible();

    await page.goto("/registrieren");

    await expect(page).toHaveURL(/\/de\/registrieren$/);
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

    await expect(page).toHaveURL(/\/de\/anmelden$/);
    await expect(
      page.getByText("Willkommen zurück", {
        exact: true,
      })
    ).toBeVisible();
  });
});
