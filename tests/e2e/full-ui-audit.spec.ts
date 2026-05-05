import { expect, test, type Page } from "@playwright/test";

import { signInAsTestUser } from "./helpers";

test.describe("full UI audit", () => {
  test.setTimeout(240_000);

  test("renders every known public and authenticated route with working internal links", async ({
    page,
  }) => {
    const publicRoutes = [
      "/",
      "/pricing",
      "/docs",
      "/datenschutz",
      "/impressum",
      "/agb",
      "/login",
      "/signup",
      "/forgot-password",
      "/reset-password",
      "/accept-invite",
    ];

    const checkedTargets = new Map<string, true>();
    const results: AuditRouteResult[] = [];

    for (const route of publicRoutes) {
      results.push(await auditRoute(page, route, checkedTargets));
    }

    await signInAsTestUser(page);
    const projectId = await getAuditedProjectId(page);
    const authenticatedRoutes = [
      "/dashboard",
      "/projects",
      `/projects/${projectId}/translations/languages`,
      `/projects/${projectId}/translations/urls`,
      `/projects/${projectId}/translations/glossary`,
      `/projects/${projectId}/translations/import-export`,
      `/projects/${projectId}/translations/visual`,
      `/projects/${projectId}/translations/slugs`,
      `/projects/${projectId}/stats/requests`,
      `/projects/${projectId}/stats/page-views`,
      `/projects/${projectId}/settings`,
      `/projects/${projectId}/settings/language-model`,
      `/projects/${projectId}/settings/switcher`,
      `/projects/${projectId}/settings/exclusions`,
      `/projects/${projectId}/settings/setup`,
      `/projects/${projectId}/settings/wordpress`,
      `/projects/${projectId}/settings/webhooks`,
      `/projects/${projectId}/settings/members`,
      `/projects/${projectId}/api-keys`,
      "/subscription",
      "/subscription/usage",
      "/subscription/billing",
      "/settings",
    ];

    for (const route of authenticatedRoutes) {
      results.push(await auditRoute(page, route, checkedTargets));
    }

    await exerciseSafeControls(page, projectId);

    const checkedLinks = results.reduce((sum, row) => sum + row.links, 0);
    const checkedInteractives = results.reduce(
      (sum, row) => sum + row.interactives,
      0
    );

    expect(checkedTargets.size, "unique checked link targets").toBeGreaterThan(50);
    expect(checkedLinks, "visible same-origin links").toBeGreaterThan(500);
    expect(checkedInteractives, "visible interactives").toBeGreaterThan(700);
  });
});

type AuditRouteResult = {
  path: string;
  interactives: number;
  links: number;
};

type VisibleInteractive = {
  tag: string;
  role: string;
  type: string;
  href: string;
  label: string;
  id: string;
  nestedInteractive: boolean;
};

async function getAuditedProjectId(page: Page) {
  await page.goto("/dashboard");

  const projectLink = page
    .locator('a[href*="/projects/"][href*="/translations/languages"]')
    .first();

  await expect(projectLink).toBeVisible();

  const href = await projectLink.getAttribute("href");
  const projectId = href?.match(/\/projects\/([^/]+)/)?.[1];

  expect(projectId, `Could not infer project ID from ${href}`).toBeTruthy();

  return projectId!;
}

async function auditRoute(
  page: Page,
  path: string,
  checkedTargets: Map<string, true>
): Promise<AuditRouteResult> {
  const response = await page.goto(path, { waitUntil: "load" });

  expect(response?.status() ?? 200, `${path} HTTP status`).toBeLessThan(400);

  await page.waitForLoadState("networkidle").catch(() => undefined);
  await expect(page.locator("body")).not.toContainText(
    /This page could not be found\.|^\s*404\s*$/m
  );
  await expect(page.locator("h1")).not.toHaveCount(0);

  const interactives = await collectVisibleInteractives(page);

  for (const item of interactives) {
    const isTextInput =
      ["input", "textarea", "select"].includes(item.tag) &&
      item.type !== "hidden";
    const needsLabel = item.tag !== "a" || item.href || item.role;

    expect(
      item.label,
      `${path} has unlabeled visible ${describeInteractive(item)}`
    ).not.toBe("");
    expect(
      item.nestedInteractive,
      `${path} has nested interactive under "${item.label || item.tag}"`
    ).toBe(false);

    if (isTextInput || needsLabel) {
      expect(
        item.label,
        `${path} has unlabeled control ${describeInteractive(item)}`
      ).not.toBe("");
    }
  }

  const links = interactives.filter((item) =>
    isSameOriginHttpLink(page, item.href)
  );

  for (const link of links) {
    await checkLinkTarget(
      page,
      page.url(),
      path,
      link.label,
      link.href,
      checkedTargets
    );
  }

  return { path, interactives: interactives.length, links: links.length };
}

async function exerciseSafeControls(page: Page, projectId: string) {
  await page.goto("/pricing");

  const yearlyToggle = page.getByText("Yearly - 2 months free", { exact: true });
  if (await yearlyToggle.isVisible().catch(() => false)) {
    await yearlyToggle.click();
  }

  await page.goto(`/projects/${projectId}/settings/language-model`);

  const configureButton = page.getByRole("button", { name: "Configure" });
  if (await configureButton.isVisible().catch(() => false)) {
    await configureButton.click();
    await page.keyboard.press("Escape").catch(() => undefined);
  }
}

async function collectVisibleInteractives(page: Page) {
  return page
    .locator(
      [
        "a",
        "button",
        "input",
        "select",
        "textarea",
        '[role="button"]',
        '[role="link"]',
        '[role="switch"]',
        '[role="checkbox"]',
        '[role="combobox"]',
        '[role="application"]',
        '[role="img"]',
        '[tabindex]:not([tabindex="-1"])',
      ].join(",")
    )
    .evaluateAll((elements) => {
      function isVisible(element: Element) {
        const style = window.getComputedStyle(element);
        const rect = element.getBoundingClientRect();

        return (
          style.visibility !== "hidden" &&
          style.display !== "none" &&
          rect.width > 0 &&
          rect.height > 0
        );
      }

      function labelFor(element: Element) {
        const labelable = element as HTMLInputElement;
        const id = element.getAttribute("id");
        const explicitLabel = id
          ? Array.from(
              document.querySelectorAll(`label[for="${CSS.escape(id)}"]`)
            )
              .map((label) => label.textContent ?? "")
              .join(" ")
              .trim()
          : "";
        const labelProp = labelable.labels
          ? Array.from(labelable.labels)
              .map((label) => label.textContent ?? "")
              .join(" ")
              .trim()
          : "";
        const value =
          element.tagName === "INPUT" &&
          ["submit", "button"].includes(
            (element.getAttribute("type") ?? "").toLowerCase()
          )
            ? element.getAttribute("value")
            : "";

        return (
          element.getAttribute("aria-label") ||
          element.getAttribute("aria-labelledby") ||
          element.getAttribute("title") ||
          (element as HTMLElement).innerText ||
          element.textContent ||
          explicitLabel ||
          labelProp ||
          element.getAttribute("placeholder") ||
          value ||
          ""
        )
          .replace(/\s+/g, " ")
          .trim();
      }

      return elements.filter(isVisible).map((element) => {
        const interactiveSelector =
          'a,button,input,select,textarea,[role="button"],[role="link"]';

        return {
          tag: element.tagName.toLowerCase(),
          role: element.getAttribute("role") ?? "",
          type: element.getAttribute("type") ?? "",
          href: element.getAttribute("href") ?? "",
          label: labelFor(element),
          id: element.getAttribute("id") ?? "",
          nestedInteractive:
            element.matches(interactiveSelector) &&
            Boolean(element.querySelector(interactiveSelector)),
        };
      });
    }) as Promise<VisibleInteractive[]>;
}

async function checkLinkTarget(
  page: Page,
  currentUrl: string,
  sourcePath: string,
  label: string,
  href: string,
  checkedTargets: Map<string, true>
) {
  const target = new URL(href, currentUrl);
  target.hash = "";

  if (target.pathname.startsWith("/api/")) return;

  const key = target.toString();
  if (checkedTargets.has(key)) return;

  const response = await page.request.get(key, {
    maxRedirects: 8,
    timeout: 20_000,
  });

  expect(
    response.status(),
    `${sourcePath} link "${label}" -> ${target.pathname} HTTP status`
  ).toBeLessThan(400);

  checkedTargets.set(key, true);
}

function isSameOriginHttpLink(page: Page, href: string) {
  if (!href || href.startsWith("#") || href.startsWith("mailto:")) {
    return false;
  }

  const target = new URL(href, page.url());
  const current = new URL(page.url());

  return (
    target.origin === current.origin &&
    (target.protocol === "http:" || target.protocol === "https:")
  );
}

function describeInteractive(item: VisibleInteractive) {
  const role = item.role ? `[role=${item.role}]` : "";
  const id = item.id ? `#${item.id}` : "";

  return `${item.tag}${role}${id}`;
}
