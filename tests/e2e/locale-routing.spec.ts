import { expect, test, type Page } from "@playwright/test";

import { getMarketingPath, SITE_LOCALES } from "../../src/lib/site-locale";

async function expectLocaleCookie(page: Page, locale: string) {
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

async function expectNoHorizontalOverflow(page: Page, path: string) {
  await expect
    .poll(
      () =>
        page.evaluate(
          () =>
            Math.max(
              document.documentElement.scrollWidth,
              document.body.scrollWidth
            ) <= document.documentElement.clientWidth + 1
        ),
      { message: `${path} should not overflow horizontally` }
    )
    .toBe(true);
}

test.describe("locale routing", () => {
  test("keeps localized homepages inside narrow responsive layouts", async ({
    page,
  }) => {
    test.setTimeout(90_000);

    for (const locale of SITE_LOCALES) {
      const route = getMarketingPath(locale, "home");
      await page.setViewportSize({ width: 320, height: 844 });
      const response = await page.goto(route, { waitUntil: "load" });
      expect(response?.status() ?? 200, `${locale} HTTP status`).toBeLessThan(400);

      for (const width of [320, 390, 420, 768]) {
        await page.setViewportSize({ width, height: 844 });

        const topBar = page.locator("nav > div").first();
        const signupLink = topBar.locator("a").last();
        const wordmark = topBar.locator('a[aria-label="Deepglot"] span span');

        await expect(signupLink, `${width}px ${locale} signup action`).toBeVisible();
        if (width < 420) {
          await expect(wordmark, `${width}px ${locale} wordmark`).toBeHidden();
        } else {
          await expect(wordmark, `${width}px ${locale} wordmark`).toBeVisible();
        }

        const layout = await page.evaluate(() => {
          const row = document.querySelector("nav > div:first-child");
          const rowRect = row?.getBoundingClientRect();
          const rowStyle = row ? window.getComputedStyle(row) : null;
          const logoRect = row
            ?.querySelector('a[aria-label="Deepglot"]')
            ?.getBoundingClientRect();
          const actionsRect = row?.lastElementChild?.getBoundingClientRect();
          const links = row ? Array.from(row.querySelectorAll("a")) : [];
          const signupRect = links.at(-1)?.getBoundingClientRect();

          return {
            documentWidth: Math.max(
              document.documentElement.scrollWidth,
              document.body.scrollWidth
            ),
            viewportWidth: document.documentElement.clientWidth,
            contentLeft:
              (rowRect?.left ?? 0) + Number.parseFloat(rowStyle?.paddingLeft ?? "0"),
            contentRight:
              (rowRect?.right ?? Number.NEGATIVE_INFINITY) -
              Number.parseFloat(rowStyle?.paddingRight ?? "0"),
            logoRight: logoRect?.right ?? Number.POSITIVE_INFINITY,
            actionsLeft: actionsRect?.left ?? Number.NEGATIVE_INFINITY,
            signupLeft: signupRect?.left ?? -1,
            signupRight: signupRect?.right ?? Number.POSITIVE_INFINITY,
          };
        });

        expect(layout.documentWidth, `${width}px ${locale} document width`).toBeLessThanOrEqual(
          layout.viewportWidth + 1
        );
        expect(layout.signupLeft, `${width}px ${locale} signup left edge`).toBeGreaterThanOrEqual(
          layout.contentLeft - 1
        );
        expect(layout.signupRight, `${width}px ${locale} signup right edge`).toBeLessThanOrEqual(
          layout.contentRight + 1
        );
        expect(
          layout.actionsLeft - layout.logoRight,
          `${width}px ${locale} logo/action gap`
        ).toBeGreaterThanOrEqual(
          8
        );
      }
    }
  });

  test("switches the marketing homepage between canonical English and German URLs", async ({
    page,
  }) => {
    await page.goto("/");

    await expect(page).toHaveURL(/\/$/);
    await expect(
      page.getByRole("heading", {
        name: /Your website speaks more than one language/i,
      })
    ).toBeVisible();

    await switchMarketingLanguage(page, "Deutsch");

    await expect(page).toHaveURL(/\/de$/);
    await expect(
      page.getByRole("heading", {
        name: /Deine Website spricht jetzt mehr als eine Sprache/i,
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
        name: /Your website speaks more than one language/i,
      })
    ).toBeVisible();
    await expectLocaleCookie(page, "en");
  });

  test("keeps the selected locale when launching the installed app", async ({
    page,
  }) => {
    await page.goto("/bg");
    await expectLocaleCookie(page, "bg");

    const manifest = await page.evaluate(async () => {
      const response = await fetch("/manifest.webmanifest?locale-regression=bg", {
        cache: "no-store",
      });
      return response.json() as Promise<{ start_url?: string; scope?: string }>;
    });

    expect(manifest.start_url).toBe("/bg");
    expect(manifest.scope).toBe("/");
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
        name: /Your website speaks more than one language/i,
      })
    ).toBeVisible();
  });

  test("opens public documentation and legal footer links", async ({ page }) => {
    await page.goto("/");

    await page
      .getByLabel("Footer")
      .getByRole("link", { name: "Documentation" })
      .click();
    await expect(page).toHaveURL(/\/docs$/);
    await expect(
      page.getByRole("heading", { name: "Integrate Deepglot" })
    ).toBeVisible();
    await expect(page.getByRole("link", { name: "API reference" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "/api/translate" })).toBeVisible();

    await page.goto("/de/dokumentation");
    await expect(page.getByRole("heading", { name: "Deepglot integrieren" })).toBeVisible();
    await expect(page.getByText(/Geschwindigkeitslimit/).first()).toBeVisible();

    await page.goto("/");
    await page.getByLabel("Footer").getByRole("link", { name: "Privacy" }).click();
    await expect(page).toHaveURL(/\/privacy$/);
    await expect(page.getByRole("heading", { name: "Privacy" })).toBeVisible();

    await page.goto("/");
    await page
      .getByLabel("Footer")
      .getByRole("link", { name: "Legal Notice" })
      .click();
    await expect(page).toHaveURL(/\/legal-notice$/);
    await expect(
      page.getByRole("heading", { name: "Legal Notice" })
    ).toBeVisible();

    await page.goto("/");
    await page.getByLabel("Footer").getByRole("link", { name: "Terms" }).click();
    await expect(page).toHaveURL(/\/terms$/);
    await expect(page.getByRole("heading", { name: "Terms" })).toBeVisible();
  });

  test("opens the bilingual help surface through canonical and internal routes", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.goto("/help");

    await expect(page).toHaveURL(/\/help$/);
    await expect(
      page.getByRole("heading", { name: "Deepglot, explained clearly" })
    ).toBeVisible();
    await expect(page.getByTestId("help-weekly-digest")).toBeVisible();
    await expect(page.getByTestId("help-wordpress-releases")).toBeVisible();
    await expect(page).toHaveTitle(/Help \| Deepglot/);
    await page.screenshot({
      path: "output/playwright/help-en-desktop.png",
      fullPage: true,
    });

    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/de/hilfe");

    await expect(page).toHaveURL(/\/de\/hilfe$/);
    await expect(
      page.getByRole("heading", { name: "Deepglot verständlich erklärt" })
    ).toBeVisible();
    await expect(page.getByTestId("help-weekly-digest")).toBeVisible();
    await expect(page.getByTestId("help-wordpress-releases")).toBeVisible();
    await expect(page).toHaveTitle(/Hilfe \| Deepglot/);
    await expectNoHorizontalOverflow(page, "/de/hilfe");
    await page.screenshot({
      path: "output/playwright/help-de-mobile.png",
      fullPage: true,
    });

    await page.goto("/fr/help");
    await expect(page).toHaveURL(/\/help$/);
    await expect(
      page.getByRole("heading", { name: "Deepglot, explained clearly" })
    ).toBeVisible();
  });

  test("keeps bilingual help discovery off other localized homepages", async ({
    page,
  }) => {
    for (const route of ["/fr", "/es"]) {
      await page.goto(route);

      await expect(page.getByTestId("marketing-weekly-digest")).toHaveCount(0);
      await expect(page.getByTestId("marketing-wordpress-releases")).toHaveCount(0);
      await expect(page.locator(`a[href="${route}/help"]`)).toHaveCount(0);
      await expect(page.getByText("Open help", { exact: true })).toHaveCount(0);
      await expect(page.getByText("Release help", { exact: true })).toHaveCount(0);
    }
  });

  test("redirects unsupported editorial locales to the real English surfaces", async ({
    page,
  }) => {
    await page.goto("/fr/blog");

    await expect.poll(() => new URL(page.url()).pathname).toBe("/blog");
    await expect(
      page.getByRole("heading", {
        name: "Ideas for an open, multilingual web.",
      })
    ).toBeVisible();

    await page.goto("/fr/documentation");

    await expect.poll(() => new URL(page.url()).pathname).toBe("/docs");
    await expect(
      page.getByRole("heading", { name: "Integrate Deepglot" })
    ).toBeVisible();
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
    await expect(page.getByText(/200\s+хил\.\s+думи/)).toHaveCount(1);
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

    await page.goto("/de/dokumentation");

    await expect(page).toHaveTitle(/Dokumentation \| Deepglot/);

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
