import { unstable_doesMiddlewareMatch } from "next/experimental/testing/server";

// Next's testing helper schedules async storage work that outlives node:test.
// Evaluate the real matcher semantics in a short-lived child process instead.
const config = JSON.parse(process.argv[2]) as { matcher: string[] };
const paths = [
  "/favicon.ico", "/icon.png", "/apple-icon.png", "/opengraph-image.png",
  "/manifest.webmanifest", "/robots.txt", "/sitemap.xml",
  "/marketing/austrian-interior-hero.png", "/marketing/deepglot-icon-192.png",
  "/file.svg", "/fonts/deepglot.woff2", "/", "/de", "/fr/tarifs", "/blog/article",
];
const results = Object.fromEntries(paths.map((pathname) => [pathname,
  unstable_doesMiddlewareMatch({ config, nextConfig: {}, url: `https://deepglot.ai${pathname}` }),
]));
process.stdout.write(JSON.stringify(results));
process.exit(0);
