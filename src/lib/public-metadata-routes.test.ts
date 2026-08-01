import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";

import manifest from "@/app/manifest";
import robots from "@/app/robots";
import sitemap from "@/app/sitemap";
import { SITE_LOCALES, withLocalePrefix } from "@/lib/site-locale";

function readPngDimensions(relativePath: string) {
  const file = readFileSync(path.join(process.cwd(), relativePath));

  assert.deepEqual(
    [...file.subarray(0, 8)],
    [137, 80, 78, 71, 13, 10, 26, 10],
    `${relativePath} must be a PNG`
  );

  return {
    width: file.readUInt32BE(16),
    height: file.readUInt32BE(20),
  };
}

test("robots excludes every localized private route root", () => {
  const rules = robots().rules;
  assert.ok(!Array.isArray(rules));
  const disallow = Array.isArray(rules.disallow)
    ? rules.disallow
    : [rules.disallow];

  for (const locale of SITE_LOCALES) {
    for (const privatePath of [
      "/dashboard",
      "/projects",
      "/subscription",
      "/settings",
    ]) {
      const localizedPath = withLocalePrefix(privatePath, locale);
      assert.ok(disallow.includes(localizedPath), localizedPath);
      assert.ok(disallow.includes(`${localizedPath}/`), `${localizedPath}/`);
    }
  }
});

test("manifest exposes installable 192, 512, and maskable icons", () => {
  const icons = manifest().icons ?? [];

  assert.ok(
    icons.some(
      (icon) =>
        icon.src === "/marketing/deepglot-icon-192.png" &&
        icon.sizes === "192x192" &&
        icon.purpose === "any"
    )
  );
  assert.ok(
    icons.some(
      (icon) =>
        icon.src === "/icon.png" &&
        icon.sizes === "512x512" &&
        icon.purpose === "any"
    )
  );
  assert.ok(
    icons.some(
      (icon) =>
        icon.src === "/marketing/deepglot-icon-maskable.png" &&
        icon.sizes === "512x512" &&
        icon.purpose === "maskable"
    )
  );

  assert.deepEqual(
    readPngDimensions("public/marketing/deepglot-icon-192.png"),
    { width: 192, height: 192 }
  );
  assert.deepEqual(
    readPngDimensions("public/marketing/deepglot-icon-maskable.png"),
    { width: 512, height: 512 }
  );
});

test("sitemap publishes all marketing locales but only real EN/DE editorial variants", () => {
  const entries = sitemap();
  const urls = entries.map((entry) => entry.url);
  const editorialUrls = urls.filter((url) => new URL(url).pathname.includes("/blog"));

  assert.equal(entries.length, 152);
  assert.equal(new Set(urls).size, entries.length);
  assert.equal(editorialUrls.length, 8);
  assert.ok(
    editorialUrls.every((url) => {
      const pathname = new URL(url).pathname;
      return pathname.startsWith("/blog") || pathname.startsWith("/de/blog");
    })
  );
});
