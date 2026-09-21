import { expect, test } from "@playwright/test";
import { createHash } from "node:crypto";
import { signInAndGetProjectId, e2eId } from "./helpers";
import { db } from "../../src/lib/db";

test("real requests preserve reported types on fresh and cache-only paths without a URL; filters reset", async ({
  page,
}) => {
  const projectId = await signInAndGetProjectId(page);
  const marker = e2eId("Reported types");
  const rawKey = `dg_live_types_${crypto.randomUUID()}`;
  const key = await db.apiKey.create({
    data: {
      projectId,
      name: "Types E2E",
      key: createHash("sha256").update(rawKey).digest("hex"),
      keyPrefix: rawKey.slice(0, 12),
    },
  });
  try {
    const post = (words: Array<{ w: string; t?: unknown }>, bot = 0) =>
      page.request.post("/api/translate", {
        headers: { Authorization: `Bearer ${rawKey}` },
        data: { l_from: "de", l_to: "en", words, bot },
      });
    const fresh = await post([
      { w: marker, t: 1 },
      { w: marker, t: 6 },
      { w: `${marker} unknown.png` },
    ]);
    expect(fresh.status(), await fresh.text()).toBe(200);
    const original = await db.translation.findFirstOrThrow({
      where: { projectId, originalText: marker },
      include: { typeObservations: true },
    });
    expect(original.typeObservations.map((o) => o.wordType).sort()).toEqual([
      1, 6,
    ]);
    const cached = await post(
      [
        { w: marker, t: 10 },
        { w: marker, t: 6 },
        { w: `${marker} unknown.png`, t: "6" },
        { w: `${marker} cache miss`, t: 8 },
      ],
      1,
    );
    expect(cached.status(), await cached.text()).toBe(200);
    expect((await cached.json()).cache_only).toBe(true);
    const after = await db.translation.findUniqueOrThrow({
      where: { id: original.id },
      include: { typeObservations: true },
    });
    expect(
      after.typeObservations.map((o) => o.wordType).sort((a, b) => a - b),
    ).toEqual([1, 6, 10]);
    expect(after.updatedAt).toEqual(original.updatedAt);
    expect(
      await db.translation.count({
        where: { projectId, originalText: `${marker} cache miss` },
      }),
    ).toBe(0);
    await page.goto(`/projects/${projectId}/translations/pros`);
    await page.getByPlaceholder("Search text...").fill(marker);
    await page.getByRole("button", { name: "Search", exact: true }).click();
    await expect(page.locator("article")).toHaveCount(2);
    const select = page.getByLabel("Reported content type", { exact: true });
    for (const group of ["text", "media", "link"]) {
      await select.selectOption(group);
      await expect(page.locator("article")).toHaveCount(1);
      await expect(page.locator("article")).not.toContainText("unknown.png");
    }
    await page
      .locator("article summary")
      .filter({ hasText: "Context and metadata" })
      .click();
    await expect(
      page
        .locator("article")
        .getByText("Reported content type:", { exact: false }),
    ).toContainText("Text, Media / documents, External links");
    await select.selectOption("unknown");
    await expect(page.locator("article")).toHaveCount(1);
    await expect(page.locator("article")).toContainText("unknown.png");
    await select.selectOption("other");
    await expect(page.locator("article")).toHaveCount(0);
    await page
      .getByRole("button", { name: "Reset filters", exact: true })
      .click();
    await expect(select).toHaveValue("");
    expect(
      (
        await page.request.get(
          `/api/projects/${projectId}/translations?reportedType=guessed`,
        )
      ).status(),
    ).toBe(400);
    for (const width of [390, 1280]) {
      await page.setViewportSize({ width, height: 900 });
      expect(
        await select.evaluate(
          (el) => el.getBoundingClientRect().right <= window.innerWidth,
        ),
      ).toBe(true);
    }
  } finally {
    await db.translation.deleteMany({
      where: { projectId, originalText: { startsWith: marker } },
    });
    await db.apiKey.delete({ where: { id: key.id } });
    await db.$disconnect();
  }
});
