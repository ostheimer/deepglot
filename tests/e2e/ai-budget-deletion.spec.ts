import { expect, test } from "@playwright/test";
import crypto from "node:crypto";
import { signInAndGetProjectId } from "./helpers";
import { db } from "@/lib/db";

test("blocked project deletion stays visible with actionable DE/EN budget guidance", async ({ page }) => {
  const seededProjectId = await signInAndGetProjectId(page);
  const seeded = await db.project.findUniqueOrThrow({ where: { id: seededProjectId },
    select: { organizationId: true } });
  const id = crypto.randomUUID();
  const project = await db.project.create({ data: { id, organizationId: seeded.organizationId,
    name: "Pending AI fixture", domain: `pending-ai-${id}.test` } });
  const reservation = await db.aiSpendReservation.create({ data: {
    organizationId: seeded.organizationId, projectId: id,
    requestKeyHash: `delete-${id}`, requestGroupHash: `delete-group-${id}`,
    dispatchId: id, actorKind: "USER", actorId: "fixture-actor", action: "TRANSLATION",
    provider: "mock", model: "mock", currency: "USD",
    periodKey: new Date().getUTCFullYear() * 100 + new Date().getUTCMonth() + 1,
    state: "UNKNOWN", reservedMicros: BigInt(100), estimatedInputUnits: 100,
    maxOutputUnits: 0, orgInputMicrosPerMillion: BigInt(1000000),
    orgOutputMicrosPerMillion: BigInt(0), projectInputMicrosPerMillion: BigInt(1000000),
    projectOutputMicrosPerMillion: BigInt(0), unit: "TOKEN",
  } });
  try {
    for (const [url, action, deleteLabel, expected] of [
      ["/projects", `Actions for ${project.domain}`, "Delete", "Project deletion is paused"],
      ["/de/projekte", `Aktionen für ${project.domain}`, "Löschen", "Die Projektlöschung ist pausiert"],
    ]) {
      await page.goto(url);
      await page.getByRole("button", { name: action }).click();
      page.once("dialog", (dialog) => dialog.accept());
      await page.getByRole("menuitem", { name: deleteLabel }).click();
      const alert = page.getByRole("alert").filter({ hasText: expected });
      await expect(alert).toContainText(expected);
      await expect(alert.getByRole("link")).toBeVisible();
      expect(await db.project.findUnique({ where: { id } })).not.toBeNull();
    }
  } finally {
    await db.aiSpendReservation.delete({ where: { id: reservation.id } });
    await db.project.deleteMany({ where: { id } });
  }
});
