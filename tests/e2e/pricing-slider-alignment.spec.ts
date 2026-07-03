import { expect, test } from "@playwright/test";

// ROADMAP 7.14 — regression guard for the pricing-slider alignment fixed in
// PR #38. The tick labels under the words slider are absolutely positioned to
// mirror the native range-thumb travel: with a 24px thumb (w-6), the thumb
// centre moves from `left + 12px` to `left + width - 12px`, so each label
// sits at `calc(12px + (100% - 24px) * idx / (n - 1))`. A change back to
// plain flex `justify-between` (or any offset drift) shifts the label centres
// away from the thumb — most visibly at both ends of the track.
//
// The expected thumb centre below intentionally re-implements the *native*
// browser thumb math (not the component's CSS calc), so the assertion fails
// whenever the component's label layout stops matching real thumb travel.

const THUMB_SIZE_PX = 24; // w-6 thumb in pricing-grid.tsx — keep in sync.
const TOLERANCE_PX = 2;

test.describe("pricing slider alignment (7.14)", () => {
  test("every tick label centre sits within ±2px of the native thumb centre", async ({
    page,
  }) => {
    await page.goto("/pricing");

    const slider = page.locator("#deepglot-words-slider");
    await expect(slider).toBeVisible();

    const min = Number((await slider.getAttribute("min")) ?? "0");
    const max = Number(await slider.getAttribute("max"));
    const tierCount = max - min + 1;

    const ticks = page.locator("#deepglot-words-slider ~ div button");
    await expect(ticks).toHaveCount(tierCount);

    const sliderBox = await slider.boundingBox();
    if (!sliderBox) {
      throw new Error("words slider has no bounding box");
    }

    for (let index = 0; index < tierCount; index += 1) {
      await slider.fill(String(min + index));
      await expect(slider).toHaveValue(String(min + index));

      const fraction = index / (tierCount - 1);
      const expectedThumbCentre =
        sliderBox.x +
        THUMB_SIZE_PX / 2 +
        (sliderBox.width - THUMB_SIZE_PX) * fraction;

      const tickBox = await ticks.nth(index).boundingBox();
      if (!tickBox) {
        throw new Error(`tick label ${index} has no bounding box`);
      }

      const tickCentre = tickBox.x + tickBox.width / 2;
      const drift = Math.abs(tickCentre - expectedThumbCentre);

      expect
        .soft(
          drift,
          `tier index ${index}: tick centre ${tickCentre.toFixed(1)}px vs thumb centre ${expectedThumbCentre.toFixed(1)}px`
        )
        .toBeLessThanOrEqual(TOLERANCE_PX);
    }
  });
});
