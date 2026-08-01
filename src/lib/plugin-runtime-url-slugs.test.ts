import assert from "node:assert/strict";
import test from "node:test";
import type { NextRequest } from "next/server";

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

  assert.equal(overflowResponse.status, 200);
  assert.equal(overflowBody.urlSlugs.length, MAX_RUNTIME_URL_SLUGS);
  assert.deepEqual(overflowBody.urlSlugs.at(-1), {
    originalSlug: "source-9999",
    translatedSlug: "target-9999",
    langTo: "en",
  });
  assert.equal(
    overflowBody.urlSlugs.some(
      (slug: { originalSlug: string }) => slug.originalSlug === "source-10000",
    ),
    false,
  );
  assert.equal(overflowBody.urlSlugsTruncated, true);
  assert.deepEqual(overflowBody.warnings, [{
    code: "runtime_url_slugs_truncated",
    detail: `The project has more than ${MAX_RUNTIME_URL_SLUGS} URL slug records. The runtime configuration is limited to the first ${MAX_RUNTIME_URL_SLUGS} records; reduce the mapping set for complete translated URL coverage.`,
    limit: MAX_RUNTIME_URL_SLUGS,
  }]);
});
