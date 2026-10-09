import { expect, test } from "@playwright/test";
import { signInAsTestUser } from "./helpers";
import { db } from "@/lib/db";

test("optional workspace preferences save, read back, and unsubscribe in English and German", async ({ page }) => {
  expect((await page.request.get("/api/user/notification-preferences")).status()).toBe(401);
  await signInAsTestUser(page);
  const initial = await page.request.get("/api/user/notification-preferences");
  const organizationId = (await initial.json()).memberships[0].organizationId as string;
  const reset = await page.request.patch("/api/user/notification-preferences", {
    data: { organizationId, category: "PRODUCT_UPDATE", frequency: "OFF", locale: "en" },
  });
  expect(reset.ok()).toBeTruthy();
  await page.goto("/settings");
  const product = page.getByRole("combobox", { name: /Product updates/ });
  await expect(product).toHaveValue("OFF");
  await product.selectOption("MONTHLY");
  await expect(product).toHaveValue("MONTHLY");
  await page.reload();
  await expect(product).toHaveValue("MONTHLY");

  await page.goto("/de/settings");
  const germanProduct = page.getByRole("combobox", { name: /Produktneuigkeiten/ });
  await expect(germanProduct).toHaveValue("MONTHLY");
  await germanProduct.selectOption("OFF");
  await expect(germanProduct).toHaveValue("OFF");
  await page.reload();
  await expect(germanProduct).toHaveValue("OFF");

  const readback = await page.request.get("/api/user/notification-preferences");
  expect(readback.ok()).toBeTruthy();
  const data = await readback.json();
  expect(data.preferences).toEqual(expect.arrayContaining([expect.objectContaining({ category: "PRODUCT_UPDATE", frequency: "OFF" })]));

  const foreign = await page.request.patch("/api/user/notification-preferences", {
    data: { organizationId: "foreign-workspace", category: "PRODUCT_UPDATE", frequency: "MONTHLY", locale: "de" },
  });
  expect(foreign.status()).toBe(404);
  const mandatory = await page.request.patch("/api/user/notification-preferences", {
    data: { organizationId: data.memberships[0].organizationId, category: "SECURITY", frequency: "OFF", locale: "de" },
  });
  expect(mandatory.status()).toBe(400);
});

test("a downgraded member can unsubscribe from billing mail but cannot opt in", async ({ page }) => {
  await signInAsTestUser(page);
  const readback = await page.request.get("/api/user/notification-preferences");
  const data = await readback.json();
  const organizationId = data.memberships[0].organizationId as string;
  const user = await db.user.findUniqueOrThrow({ where: { email: process.env.TEST_LOGIN_EMAIL ?? "preview@deepglot.local" } });
  const key = { userId_organizationId: { userId: user.id, organizationId } };
  const previous = await db.organizationMember.findUniqueOrThrow({ where: key, select: { role: true } });
  try {
    const enabled = await page.request.patch("/api/user/notification-preferences", {
      data: { organizationId, category: "BILLING_SUMMARY", frequency: "MONTHLY", locale: "en" },
    });
    expect(enabled.ok()).toBeTruthy();
    await page.goto("/settings");
    const billing = page.getByRole("combobox", { name: /Billing summaries/ });
    await expect(billing).toHaveValue("MONTHLY");
    await db.organizationMember.update({ where: key, data: { role: "MEMBER" } });
    const forbidden = await page.request.patch("/api/user/notification-preferences", {
      data: { organizationId, category: "BILLING_SUMMARY", frequency: "MONTHLY", locale: "en" },
    });
    expect(forbidden.status()).toBe(403);
    await billing.selectOption("OFF");
    await expect(billing).toHaveValue("OFF");
    await expect(billing.locator('option[value="MONTHLY"]')).toHaveAttribute("disabled", "");
    const saved = await page.request.get("/api/user/notification-preferences");
    const prefs = (await saved.json()).preferences;
    expect(prefs).toEqual(expect.arrayContaining([expect.objectContaining({ organizationId, category: "BILLING_SUMMARY", frequency: "OFF" })]));
  } finally {
    await db.organizationMember.update({ where: key, data: { role: previous.role } });
    await db.$disconnect();
  }
});

test("a delayed older readback cannot overwrite a newer category change", async ({ page }) => {
  await signInAsTestUser(page);
  const initial = await page.request.get("/api/user/notification-preferences");
  const organizationId = (await initial.json()).memberships[0].organizationId as string;
  for (const category of ["PRODUCT_UPDATE", "PROJECT_ACTIVITY"]) {
    const off = await page.request.patch("/api/user/notification-preferences", {
      data: { organizationId, category, frequency: "OFF", locale: "en" },
    });
    expect(off.ok()).toBeTruthy();
  }
  await page.goto("/settings");
  const product = page.getByRole("combobox", { name: /Product updates/ });
  const project = page.getByRole("combobox", { name: /Project notices/ });
  await expect(product).toHaveValue("OFF");
  await expect(project).toHaveValue("OFF");

  let releaseFirstRead!: () => void;
  let signalFirstRead!: () => void;
  const firstReadStarted = new Promise<void>((resolve) => { signalFirstRead = resolve; });
  const firstReadGate = new Promise<void>((resolve) => { releaseFirstRead = resolve; });
  let held = false;
  await page.route("**/api/user/notification-preferences", async (route) => {
    if (route.request().method() !== "GET" || held) return route.continue();
    held = true;
    const response = await route.fetch();
    const body = await response.body();
    signalFirstRead();
    await firstReadGate;
    await route.fulfill({ response, body });
  });

  await product.selectOption("MONTHLY");
  await firstReadStarted;
  await expect(project).toBeDisabled();
  releaseFirstRead();
  await expect(project).toBeEnabled();
  await project.selectOption("WEEKLY");
  await expect(project).toHaveValue("WEEKLY");
  await page.reload();
  await expect(project).toHaveValue("WEEKLY");

  await product.selectOption("OFF");
  await project.selectOption("OFF");
});
