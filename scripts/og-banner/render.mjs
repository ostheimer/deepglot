// Renders scripts/og-banner/banner.html to src/app/opengraph-image.png (1200x630).
// Usage: node scripts/og-banner/render.mjs
// Needs network access once for the Manrope webfont. Bump the ?v= query on
// /opengraph-image.png in src/app/layout.tsx and src/lib/marketing-metadata.ts
// afterwards so X/Facebook/LinkedIn fetch the new file instead of their cache.
import { fileURLToPath } from "node:url";
import path from "node:path";
import { chromium } from "playwright";

const here = path.dirname(fileURLToPath(import.meta.url));
const html = path.join(here, "banner.html");
const out = path.resolve(here, "../../src/app/opengraph-image.png");

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1200, height: 630 }, deviceScaleFactor: 1 });
await page.goto(`file://${html}`, { waitUntil: "networkidle" });
await page.evaluate(() => document.fonts.ready);
await page.waitForTimeout(300);
await page.screenshot({ path: out, type: "png" });
await browser.close();
console.log(`wrote ${out}`);
