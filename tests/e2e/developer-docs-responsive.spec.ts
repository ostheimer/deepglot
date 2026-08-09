import { expect, test, type Page } from "@playwright/test";

const DOC_ROUTES = ["/docs", "/de/dokumentation"] as const;

test.describe("developer documentation responsive layout", () => {
  for (const route of DOC_ROUTES) {
    test(`${route} contains wide documentation content at 320px`, async ({
      page,
    }) => {
      await page.setViewportSize({ width: 320, height: 844 });
      await page.goto(route, { waitUntil: "load" });

      await expect(page.locator("main h1")).toBeVisible();
      await expectNoGlobalHorizontalOverflow(page, route, 320);

      const codeBlocks = page.locator("main pre");
      await expect(codeBlocks.first()).toBeVisible();
      await expect
        .poll(() => codeBlocks.count(), {
          message: `${route} should render documented request and response examples`,
        })
        .toBeGreaterThan(0);

      const codeBlockLayout = await codeBlocks.evaluateAll((blocks) =>
        blocks.map((block) => {
          const rect = block.getBoundingClientRect();
          return {
            clientWidth: block.clientWidth,
            left: rect.left,
            right: rect.right,
            overflowX: getComputedStyle(block).overflowX,
            scrollWidth: block.scrollWidth,
          };
        })
      );

      expect(
        codeBlockLayout.some((block) => block.scrollWidth > block.clientWidth),
        `${route} should keep long code content inside an internal scroller`
      ).toBe(true);

      for (const [index, block] of codeBlockLayout.entries()) {
        expect(
          block.left,
          `${route} code block ${index + 1} should stay inside the viewport`
        ).toBeGreaterThanOrEqual(0);
        expect(
          block.right,
          `${route} code block ${index + 1} should stay inside the viewport`
        ).toBeLessThanOrEqual(321);
        expect(
          ["auto", "scroll"],
          `${route} code block ${index + 1} should scroll internally`
        ).toContain(block.overflowX);
      }
    });
  }

  test("keeps the existing 390px and desktop documentation shells contained", async ({
    page,
  }) => {
    for (const viewport of [
      { width: 390, height: 844 },
      { width: 1440, height: 1000 },
    ]) {
      await page.setViewportSize(viewport);

      for (const route of DOC_ROUTES) {
        await page.goto(route, { waitUntil: "load" });
        await expectNoGlobalHorizontalOverflow(
          page,
          `${route} at ${viewport.width}px`,
          viewport.width
        );
      }
    }
  });
});

async function expectNoGlobalHorizontalOverflow(
  page: Page,
  label: string,
  viewportWidth: number
) {
  await expect
    .poll(
      () =>
        page.evaluate(() => ({
          body: document.body.scrollWidth,
          document: document.documentElement.scrollWidth,
          main: document.querySelector("main")?.scrollWidth ?? 0,
          viewport: document.documentElement.clientWidth,
        })),
      { message: `${label} should not overflow horizontally` }
    )
    .toEqual({
      body: viewportWidth,
      document: viewportWidth,
      main: viewportWidth,
      viewport: viewportWidth,
    });
}
