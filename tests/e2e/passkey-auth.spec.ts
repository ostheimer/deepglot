import { expect, test } from "@playwright/test";

import { signInAsTestUser } from "./helpers";

const passkeyLocales = [
  {
    name: "English",
    settingsPath: "/settings",
    loginPath: "/login",
    dashboardURL: /\/dashboard$/,
    dashboardHeading: "Overview",
    addButton: "Add passkey",
    removeButton: /remove passkey/i,
    loginButton: "Sign in with passkey",
    confirmRemoveButton: "Remove",
    failedLogin: "Passkey sign-in was cancelled or failed.",
  },
  {
    name: "German",
    settingsPath: "/de/einstellungen",
    loginPath: "/de/anmelden",
    dashboardURL: /\/de\/dashboard$/,
    dashboardHeading: "Übersicht",
    addButton: "Passkey hinzufügen",
    removeButton: /passkey \d+ entfernen/i,
    loginButton: "Mit Passkey anmelden",
    confirmRemoveButton: "Entfernen",
    failedLogin:
      "Die Passkey-Anmeldung wurde abgebrochen oder ist fehlgeschlagen.",
  },
] as const;

for (const locale of passkeyLocales) {
  test(`registers, uses, and revokes a passkey in ${locale.name}`, async ({
    context,
    page,
    request,
  }) => {
    const cdp = await context.newCDPSession(page);
    await cdp.send("WebAuthn.enable");
    const { authenticatorId } = await cdp.send(
      "WebAuthn.addVirtualAuthenticator",
      {
        options: {
          protocol: "ctap2",
          ctap2Version: "ctap2_1",
          transport: "internal",
          hasResidentKey: true,
          hasUserVerification: true,
          isUserVerified: true,
          automaticPresenceSimulation: true,
        },
      }
    );

    let initialPasskeyCount = 0;
    let passkeyCreated = false;

    try {
      await signInAsTestUser(page);
      await page.goto(locale.settingsPath);

      const removeButtons = page.getByRole("button", {
        name: locale.removeButton,
      });
      initialPasskeyCount = await removeButtons.count();

      await page.getByRole("button", { name: locale.addButton }).click();
      await expect(removeButtons).toHaveCount(initialPasskeyCount + 1);
      passkeyCreated = true;

      await context.clearCookies();
      await page.goto(locale.loginPath);

      for (const email of [
        "preview@deepglot.local",
        "unknown-passkey-user@deepglot.local",
      ]) {
        const unauthorizedEnrollment = await request.get(
          `/api/auth/webauthn-options/passkey?action=register&email=${encodeURIComponent(email)}`
        );
        expect(unauthorizedEnrollment.status()).toBe(400);
      }

      await page.getByRole("button", { name: locale.loginButton }).click();
      await page.waitForURL(locale.dashboardURL, { timeout: 15_000 });
      await expect(
        page.getByRole("heading", { name: locale.dashboardHeading })
      ).toBeVisible();

      await page.goto(locale.settingsPath);
      await removeButtons.last().click();
      await page
        .getByRole("button", {
          name: locale.confirmRemoveButton,
          exact: true,
        })
        .click();
      await expect(removeButtons).toHaveCount(initialPasskeyCount);
      passkeyCreated = false;

      await context.clearCookies();
      await page.goto(locale.loginPath);
      await page.getByRole("button", { name: locale.loginButton }).click();
      await expect(page.getByText(locale.failedLogin)).toBeVisible();
      await expect(page).toHaveURL(new RegExp(`${locale.loginPath}$`));
    } finally {
      if (passkeyCreated) {
        await page.goto(locale.settingsPath);
        if (
          page.url().includes("/login") ||
          page.url().includes("/anmelden")
        ) {
          await page.getByRole("button", { name: locale.loginButton }).click();
          await page.waitForURL(locale.dashboardURL, { timeout: 15_000 });
          await page.goto(locale.settingsPath);
        }

        const removeButtons = page.getByRole("button", {
          name: locale.removeButton,
        });
        if ((await removeButtons.count()) > initialPasskeyCount) {
          await removeButtons.last().click();
          await page
            .getByRole("button", {
              name: locale.confirmRemoveButton,
              exact: true,
            })
            .click();
        }
      }

      await cdp.send("WebAuthn.removeVirtualAuthenticator", {
        authenticatorId,
      });
      await cdp.send("WebAuthn.disable");
    }
  });
}
