import { expect, test } from "@playwright/test";
import { randomUUID } from "node:crypto";
import { encode } from "next-auth/jwt";
import { db } from "@/lib/db";
import { getTestLoginConfig } from "@/lib/test-login-config";
import { signInAsTestUser } from "./helpers";

test("billing pages and APIs stay within the selected workspace for two accounts", async ({ page, browser }) => {
  await signInAsTestUser(page);
  const actor = await db.user.findUniqueOrThrow({ where: { email: getTestLoginConfig().email } });
  const original = await db.organizationMember.findFirstOrThrow({ where: { userId: actor.id }, select: { organizationId: true } });
  const suffix = randomUUID();
  const secondEmail = `workspace-billing-${suffix}@example.invalid`;
  const second = await db.user.create({ data: { email: secondEmail } });
  const destination = await db.organization.create({ data: { name: `Second fixture ${suffix}`, slug: `second-${suffix}`,
    members: { create: [
      { userId: actor.id, role: "OWNER" },
      { userId: second.id, role: "OWNER" },
    ] },
    subscription: { create: { stripeCustomerId: `free_fixture_${suffix}`, status: "ACTIVE", plan: "FREE", wordsLimit: 2_000 } },
  } });
  try {
    await page.goto(`/subscription/overview?workspaceId=${original.organizationId}`);
    await expect(page.getByRole("combobox", { name: "Billing workspace" })).toHaveValue(original.organizationId);
    await page.getByRole("combobox", { name: "Billing workspace" }).selectOption(destination.id);
    await expect(page).toHaveURL(new RegExp(`workspaceId=${destination.id}`));
    await expect(page.getByRole("combobox", { name: "Billing workspace" })).toHaveValue(destination.id);
    await expect(page.getByRole("link", { name: "Billing & Invoices" })).toHaveAttribute("href", new RegExp(`workspaceId=${destination.id}`));
    await page.getByRole("link", { name: "Billing & Invoices" }).click();
    await expect(page).toHaveURL(new RegExp(`/subscription/billing\\?workspaceId=${destination.id}`));

    const otherContext = await browser.newContext({ baseURL: process.env.PLAYWRIGHT_BASE_URL ?? "http://localhost:3000" });
    try {
      const sessionCookie = (await page.context().cookies()).find((cookie) => cookie.name.endsWith("authjs.session-token"));
      expect(sessionCookie).toBeDefined();
      const token = await encode({ token: { id: second.id, sub: second.id, email: secondEmail },
        secret: process.env.AUTH_SECRET!, salt: sessionCookie!.name });
      await otherContext.addCookies([{ ...sessionCookie!, value: token }]);
      const otherPage = await otherContext.newPage();
      await otherPage.goto("/dashboard");
      await expect(otherPage.getByRole("heading", { name: "Overview" })).toBeVisible();
      const listed = await otherPage.request.get("/api/workspaces");
      expect(listed.ok()).toBe(true);
      expect((await listed.json()).workspaces.map((row: { id: string }) => row.id)).toEqual([destination.id]);

      await otherPage.goto(`/subscription/overview?workspaceId=${original.organizationId}`);
      await expect(otherPage.getByText("Choose a workspace in the sidebar.")).toBeVisible();
      for (const endpoint of ["cancel", "portal", "address"]) {
        const response = await otherPage.request.post(`/api/billing/${endpoint}`, {
          data: { workspaceId: original.organizationId },
        });
        expect(response.status()).toBe(409);
      }
      await otherPage.goto(`/subscription/overview?workspaceId=${destination.id}`);
      await expect(otherPage.getByRole("combobox", { name: "Billing workspace" })).toHaveValue(destination.id);
      await expect(otherPage.getByRole("heading", { name: "Plan overview" })).toBeVisible();
    } finally {
      await otherContext.close();
    }
  } finally {
    await db.organization.delete({ where: { id: destination.id } });
    await db.user.delete({ where: { id: second.id } });
    await db.$disconnect();
  }
});
