import assert from "node:assert/strict";
import test from "node:test";

import { unstable_doesMiddlewareMatch } from "next/experimental/testing/server";

import { config } from "@/proxy";

const STATIC_AND_METADATA_PATHS = [
  "/favicon.ico",
  "/icon.png",
  "/apple-icon.png",
  "/opengraph-image.png",
  "/manifest.webmanifest",
  "/nl/manifest.webmanifest",
  "/robots.txt",
  "/sitemap.xml",
  "/marketing/austrian-interior-hero.png",
  "/marketing/deepglot-icon-192.png",
  "/file.svg",
  "/fonts/deepglot.woff2",
] as const;

test("metadata and static asset requests bypass the locale-cookie proxy", () => {
  for (const pathname of STATIC_AND_METADATA_PATHS) {
    assert.equal(
      unstable_doesMiddlewareMatch({
        config,
        nextConfig: {},
        url: `https://deepglot.ai${pathname}`,
      }),
      false,
      `${pathname} would execute the proxy and could reset the locale cookie`
    );
  }
});

test("page requests still execute the locale proxy", () => {
  for (const pathname of ["/", "/de", "/fr/tarifs", "/blog/article"]) {
    assert.equal(
      unstable_doesMiddlewareMatch({
        config,
        nextConfig: {},
        url: `https://deepglot.ai${pathname}`,
      }),
      true,
      `${pathname} must still execute the proxy`
    );
  }
});
