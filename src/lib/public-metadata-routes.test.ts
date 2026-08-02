import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { NextRequest } from "next/server";

import { GET as manifestRoute } from "@/app/manifest.webmanifest/route";
import { buildLocalizedManifest, getManifestHref } from "@/lib/manifest";
import robots from "@/app/robots";
import sitemap from "@/app/sitemap";
import {
  getMarketingPath,
  SITE_LOCALES,
  withLocalePrefix,
} from "@/lib/site-locale";

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
  const icons = buildLocalizedManifest("en").icons ?? [];

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

test("manifest launches in the selected locale without narrowing the app scope", () => {
  const manifest = buildLocalizedManifest("bg");

  assert.equal(manifest.start_url, "/bg");
  assert.equal(manifest.scope, "/");
});

test("manifest link carries the selected locale without relying on cookies", () => {
  const layoutSource = readFileSync(
    path.join(process.cwd(), "src", "app", "layout.tsx"),
    "utf8"
  );
  const manifestRouteSource = readFileSync(
    path.join(process.cwd(), "src", "app", "manifest.webmanifest", "route.ts"),
    "utf8"
  );

  assert.equal(getManifestHref("bg"), "/manifest.webmanifest?locale=bg");
  assert.doesNotMatch(layoutSource, /manifest:\s*"\/manifest\.webmanifest"/);
  assert.match(layoutSource, /getManifestHref\(locale\)/);
  assert.match(
    manifestRouteSource,
    /request\.nextUrl\.searchParams\.get\(MANIFEST_LOCALE_PARAM\)/
  );
});

test("manifest route reads the explicit locale query without a cookie", async () => {
  const response = manifestRoute(
    new NextRequest("https://deepglot.ai/manifest.webmanifest?locale=bg")
  );
  const manifest = await response.json();

  assert.equal(
    response.headers.get("content-type"),
    "application/manifest+json; charset=utf-8"
  );
  assert.equal(manifest.start_url, "/bg");
  assert.equal(manifest.scope, "/");
});

test("manifest route keeps the locale cookie fallback for existing installs", async () => {
  const response = manifestRoute(
    new NextRequest("https://deepglot.ai/manifest.webmanifest?locale-regression=bg", {
      headers: {
        cookie: "deepglot-locale=bg",
      },
    })
  );
  const manifest = await response.json();

  assert.equal(manifest.start_url, "/bg");
  assert.equal(manifest.scope, "/");
});

test("sitemap publishes only routes with content in the advertised locale", () => {
  const entries = sitemap();
  const urls = entries.map((entry) => entry.url);
  const editorialUrls = urls.filter((url) => new URL(url).pathname.includes("/blog"));
  const possibleDocumentationUrls = new Set(
    SITE_LOCALES.map(
      (locale) => `https://deepglot.ai${getMarketingPath(locale, "docs")}`
    )
  );
  const documentationUrls = urls.filter((url) =>
    possibleDocumentationUrls.has(url)
  );

  assert.equal(entries.length, 130);
  assert.equal(new Set(urls).size, entries.length);
  assert.equal(editorialUrls.length, 8);
  assert.deepEqual(documentationUrls.sort(), [
    "https://deepglot.ai/de/dokumentation",
    "https://deepglot.ai/docs",
  ]);
  assert.ok(
    editorialUrls.every((url) => {
      const pathname = new URL(url).pathname;
      return pathname.startsWith("/blog") || pathname.startsWith("/de/blog");
    })
  );
});
