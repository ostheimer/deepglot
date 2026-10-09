import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import path from "node:path";
import test from "node:test";

// Read the matcher without evaluating NextAuth's request runtime in Node's
// unit-test process. Importing proxy.ts schedules Next async storage work after
// the tests end and crashes the worker outside a request context.
const source = readFileSync(path.join(process.cwd(), "src/proxy.ts"), "utf8");
const matcherLiteral = source.match(/matcher:\s*\[\s*("(?:\\.|[^"\\])*")/)?.[1];
assert.ok(matcherLiteral, "proxy matcher must be declared");
const config = { matcher: [JSON.parse(matcherLiteral) as string] };
const results = JSON.parse(execFileSync(process.execPath, ["--import", "tsx", "src/lib/proxy-static-assets-matcher-child.ts",
  JSON.stringify(config)], { encoding: "utf8" })) as Record<string, boolean>;

const STATIC_AND_METADATA_PATHS = [
  "/favicon.ico",
  "/icon.png",
  "/apple-icon.png",
  "/opengraph-image.png",
  "/manifest.webmanifest",
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
      results[pathname],
      false,
      `${pathname} would execute the proxy and could reset the locale cookie`
    );
  }
});

test("page requests still execute the locale proxy", () => {
  for (const pathname of ["/", "/de", "/fr/tarifs", "/blog/article"]) {
    assert.equal(
      results[pathname],
      true,
      `${pathname} must still execute the proxy`
    );
  }
});
