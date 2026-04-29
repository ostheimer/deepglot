import { expect, type Page } from "@playwright/test";

export const seededProjectDomain =
  process.env.TEST_LOGIN_PROJECT_DOMAIN ?? "localhost:3000";

export function e2eId(prefix: string) {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

export async function signInAsTestUser(page: Page) {
  await page.goto("/login");

  const testLoginButton = page.getByRole("button", {
    name: /sign in as test user/i,
  });
  await expect(testLoginButton).toBeVisible();
  await testLoginButton.click();

  await page.waitForURL(/\/dashboard$/, { timeout: 15_000 });
  await expect(page.getByRole("heading", { name: "Overview" })).toBeVisible();
}

export async function getSeededProjectId(page: Page) {
  await page.goto("/dashboard");

  const projectLinks = page.locator(
    'a[href*="/projects/"][href*="/translations/languages"]'
  );
  let projectLink = projectLinks.filter({ hasText: seededProjectDomain }).first();

  if (!(await projectLink.isVisible().catch(() => false))) {
    projectLink = projectLinks.first();
  }

  await expect(projectLink).toBeVisible();
  const href = await projectLink.getAttribute("href");
  const projectId = href?.match(/\/projects\/([^/]+)/)?.[1];
  expect(projectId, `Could not infer project id from ${href}`).toBeTruthy();

  return projectId!;
}

export async function signInAndGetProjectId(page: Page) {
  await signInAsTestUser(page);
  return getSeededProjectId(page);
}
