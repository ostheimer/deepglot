import assert from "node:assert/strict";
import test from "node:test";
import type { NextRequest } from "next/server";
import { buildRuntimeUrlSlugs } from "@/lib/runtime-url-slugs";

const WORDPRESS_INFRASTRUCTURE_SEGMENTS = [
  "wp-json",
  "wp-admin",
  "wp-content",
  "wp-includes",
  "wp-login.php",
  "wp-cron.php",
  "xmlrpc.php",
  "wp-comments-post.php",
  "wp-mail.php",
  "wp-trackback.php",
  "wp-signup.php",
  "wp-activate.php",
  "wp-links-opml.php",
] as const;

let runtimeSlugRows: Array<{
  originalSlug: string;
  translatedSlug: string | null;
  langTo: string;
}> = [];

const apiKeyFindUnique = test.mock.fn(async () => ({
  id: "api_key_1",
  projectId: "project_current",
  isActive: true,
  expiresAt: null,
  project: {
    organization: { subscription: null },
    languages: [],
    settings: null,
  },
}));
const apiKeyUpdate = test.mock.fn(async () => ({}));
const exclusionFindMany = test.mock.fn(async () => []);
const slugFindMany = test.mock.fn(async (_args: unknown) => {
  void _args;
  return runtimeSlugRows;
});
const rateLimitQuery = test.mock.fn(async () => [{
  scope: "plugin",
  subjectHash: "hash",
  count: 1,
  resetAt: new Date(Date.now() + 60_000),
}]);

(globalThis as unknown as { prisma: unknown }).prisma = {
  apiKey: {
    findUnique: apiKeyFindUnique,
    update: apiKeyUpdate,
  },
  translationExclusion: {
    findMany: exclusionFindMany,
  },
  urlSlug: {
    findMany: slugFindMany,
  },
  $queryRaw: rateLimitQuery,
};

test("omits reserved WordPress infrastructure segments from runtime slug mappings", () => {
  const reservedTargets = WORDPRESS_INFRASTRUCTURE_SEGMENTS.map(
    (translatedSlug, index) => ({
      originalSlug: `source-${index}`,
      translatedSlug,
      langTo: "en",
    }),
  );
  assert.deepEqual(buildRuntimeUrlSlugs(reservedTargets), []);

  assert.deepEqual(buildRuntimeUrlSlugs([
    { originalSlug: "foo", translatedSlug: "wp-json", langTo: "en" },
    { originalSlug: "bar", translatedSlug: "foo", langTo: "en" },
  ]), [], "A row with a rejected target must still reserve its real source slug.");

  const reservedOriginals = WORDPRESS_INFRASTRUCTURE_SEGMENTS.map(
    (originalSlug, index) => ({
      originalSlug,
      translatedSlug: `target-${index}`,
      langTo: "en",
    }),
  );
  assert.deepEqual(buildRuntimeUrlSlugs(reservedOriginals), []);

  assert.deepEqual(buildRuntimeUrlSlugs([
    { originalSlug: "WP-JSON", translatedSlug: "upper-case", langTo: "en" },
    { originalSlug: "encoded-target", translatedSlug: "wp%2Dadmin", langTo: "en" },
  ]), []);

  assert.deepEqual(buildRuntimeUrlSlugs([
    { originalSlug: "wp-json-guide", translatedSlug: "api-guide", langTo: "en" },
    { originalSlug: "content-tools", translatedSlug: "wp-content-tools", langTo: "en" },
  ]), [
    { originalSlug: "wp-json-guide", translatedSlug: "api-guide", langTo: "en" },
    { originalSlug: "content-tools", translatedSlug: "wp-content-tools", langTo: "en" },
  ]);
});

test("returns only bounded, nonempty URL slug mappings for the API key project", async () => {
  const { GET, MAX_RUNTIME_URL_SLUGS } = await import(
    "@/app/api/plugin/runtime-config/route"
  );

  runtimeSlugRows = [
    { originalSlug: "ueber-uns", translatedSlug: "about-us", langTo: "en" },
    {
      originalSlug: "literal-percent",
      translatedSlug: "foo%252Fbar",
      langTo: "en",
    },
    { originalSlug: "leer", translatedSlug: "   ", langTo: "en" },
    { originalSlug: "produkte", translatedSlug: "products", langTo: "en" },
    { originalSlug: "products", translatedSlug: null, langTo: "en" },
  ];

  const response = await GET(
    new Request(
      "https://deepglot.test/api/plugin/runtime-config?api_key=dg_live_current",
    ) as NextRequest,
  );
  const body = await response.json();

  assert.equal(response.status, 200);
  assert.deepEqual(body.urlSlugs, [
    { originalSlug: "ueber-uns", translatedSlug: "about-us", langTo: "en" },
    {
      originalSlug: "literal-percent",
      translatedSlug: "foo%252Fbar",
      langTo: "en",
    },
  ]);
  assert.equal(slugFindMany.mock.callCount(), 1);
  assert.deepEqual(slugFindMany.mock.calls[0].arguments[0], {
    where: {
      projectId: "project_current",
    },
    orderBy: [{ langTo: "asc" }, { originalSlug: "asc" }],
    select: {
      originalSlug: true,
      translatedSlug: true,
      langTo: true,
    },
    take: MAX_RUNTIME_URL_SLUGS + 1,
  });

  runtimeSlugRows = Array.from(
    { length: MAX_RUNTIME_URL_SLUGS + 1 },
    (_, index) => ({
      originalSlug: `source-${index}`,
      translatedSlug: `target-${index}`,
      langTo: "en",
    }),
  );

  const overflowResponse = await GET(
    new Request(
      "https://deepglot.test/api/plugin/runtime-config?api_key=dg_live_current",
    ) as NextRequest,
  );
  const overflowBody = await overflowResponse.json();

  assert.equal(overflowResponse.status, 413);
  assert.equal(overflowBody.code, "runtime_url_slugs_limit_exceeded");
  assert.equal("urlSlugs" in overflowBody, false);
});
