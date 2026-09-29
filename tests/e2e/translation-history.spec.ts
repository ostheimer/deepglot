import { expect, test } from "@playwright/test";
import { db } from "../../src/lib/db";
import { e2eId, signInAndGetProjectId } from "./helpers";

test.afterAll(async () => { await db.$disconnect(); });

for (const locale of ["en", "de"] as const) {
  test(`workspace history loads lazily and persists direct edits (${locale})`, async ({ page, request }) => {
    const projectId = await signInAndGetProjectId(page);
    const marker = e2eId("History fixture");
    const row = await db.translation.create({ data: {
      projectId, originalHash: marker, originalText: marker, translatedText: "Original target", langFrom: "de", langTo: "en", source: "MOCK",
    } });
    try {
      await page.context().addCookies([{ name: "deepglot-locale", value: locale, url: new URL(page.url()).origin }]);
      await page.goto(locale === "de" ? `/projekte/${projectId}/uebersetzungen/profis` : `/projects/${projectId}/translations/pros`);
      await page.getByPlaceholder(locale === "de" ? "Text suchen..." : "Search text...").fill(marker);
      await page.getByRole("button", { name: locale === "de" ? "Suchen" : "Search", exact: true }).click();
      const article = page.locator("article").filter({ hasText: marker });
      await expect(article).toHaveCount(1);
      let historyRequests = 0;
      page.on("request", (req) => { if (req.url().includes(`/translations/${row.id}/history`)) historyRequests++; });
      const title = locale === "de" ? "Änderungsverlauf" : "Change history";
      await article.locator("summary").filter({ hasText: title }).click();
      await expect(article.getByText(locale === "de" ? "Keine Änderungen im Workspace aufgezeichnet." : "No recorded workspace edits.")).toBeVisible();
      expect(historyRequests).toBe(1);
      await article.getByRole("button", { name: locale === "de" ? "Bearbeiten" : "Edit", exact: true }).click();
      await article.locator("textarea").fill("Saved <script>fixture</script>");
      await article.getByRole("button", { name: locale === "de" ? "Speichern" : "Save", exact: true }).click();
      await expect(article.getByRole("button", { name: locale === "de" ? "Bearbeiten" : "Edit", exact: true })).toBeVisible();
      await article.locator("summary").filter({ hasText: title }).click();
      await expect(article.locator("dd").first()).toHaveText("Original target");
      await expect(article.locator("dd").last()).toHaveText("Saved <script>fixture</script>");
      await expect(article.locator("script")).toHaveCount(0);
      expect(historyRequests).toBe(2);
      await page.reload();
      await page.getByPlaceholder(locale === "de" ? "Text suchen..." : "Search text...").fill(marker);
      await page.getByRole("button", { name: locale === "de" ? "Suchen" : "Search", exact: true }).click();
      await article.locator("summary").filter({ hasText: title }).click();
      await expect(article.locator("dd").last()).toHaveText("Saved <script>fixture</script>");
      await article.screenshot({ path: `output/history/history-${locale}.png` });
      const historyUrl = `/api/projects/${projectId}/translations/${row.id}/history`;
      expect((await request.get(historyUrl)).status()).toBe(401);
      expect((await page.request.get(`${historyUrl}?pageSize=21`)).status()).toBe(400);
      expect((await page.request.get(`/api/projects/foreign/translations/${row.id}/history`)).status()).toBe(404);
      const response = await page.request.get(historyUrl);
      expect(response.headers()["cache-control"]).toBe("private, no-store");
      const result = await response.json();
      expect(result.items).toHaveLength(1);
      expect(Object.keys(result.items[0].actor)).toEqual(["name"]);
      // Synthetic imported content can exceed the workspace's edit limit.
      await db.translationContentRevision.create({ data: { translationId: row.id, beforeText: "🦉".repeat(1_000_000), afterText: "Saved imported fixture" } });
      await page.reload();
      await page.getByPlaceholder(locale === "de" ? "Text suchen..." : "Search text...").fill(marker);
      await page.getByRole("button", { name: locale === "de" ? "Suchen" : "Search", exact: true }).click();
      await article.locator("summary").filter({ hasText: title }).click();
      await expect(article.getByText(locale === "de" ? "Langer Text wird in dieser Vorschau gekürzt. Die vollständige Änderung ist gespeichert." : "Long text is shortened in this preview. The complete change is stored.")).toBeVisible();
      const largePage = await (await page.request.get(`${historyUrl}?pageSize=1`)).json();
      expect(largePage.items[0].textTruncated).toBe(true);
      expect(largePage.nextCursor).toBe(largePage.items[0].id);
      expect((await (await page.request.get(`${historyUrl}?cursor=${largePage.nextCursor}`)).json()).items[0].afterText).toBe("Saved <script>fixture</script>");
    } finally {
      await db.translation.deleteMany({ where: { id: row.id } });
    }
  });
}

test("history API rechecks current membership and target-language scope", async ({ page }) => {
  await signInAndGetProjectId(page);
  const user = await db.user.findUniqueOrThrow({ where: { email: "preview@deepglot.local" } });
  const marker = e2eId("History access");
  const organization = await db.organization.create({ data: { name: marker, slug: marker } });
  const project = await db.project.create({ data: {
    name: marker, domain: `${marker}.example.test`, organizationId: organization.id,
    languages: { create: [{ langCode: "en" }, { langCode: "fr" }] },
  } });
  const member = await db.projectMember.create({ data: {
    projectId: project.id, userId: user.id, email: user.email, role: "TRANSLATOR", langCode: "en",
  } });
  try {
    const rows = await Promise.all(["en", "fr"].map((langTo) => db.translation.create({ data: {
      projectId: project.id, originalHash: `${marker}-${langTo}`, originalText: marker, translatedText: "Fixture", langFrom: "de", langTo,
      contentRevisions: { create: { beforeText: "Before fixture", afterText: "Fixture", actorUserId: user.id } },
    }, include: { contentRevisions: true } })));
    const url = (id: string) => `/api/projects/${project.id}/translations/${id}/history`;
    expect((await page.request.get(url(rows[0].id))).status()).toBe(200);
    expect((await page.request.get(url(rows[1].id))).status()).toBe(403);
    expect((await page.request.get(`${url(rows[0].id)}?cursor=${rows[1].contentRevisions[0].id}`)).status()).toBe(400);
    await db.projectMember.delete({ where: { id: member.id } });
    expect((await page.request.get(url(rows[0].id))).status()).toBe(404);
  } finally {
    await db.organization.delete({ where: { id: organization.id } });
  }
});
