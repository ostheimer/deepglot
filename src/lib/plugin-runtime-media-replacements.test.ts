import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import type { NextRequest } from "next/server";

import { buildRuntimeMediaReplacements } from "@/lib/media-replacements";

const currentApiKey = "dg_live_runtime_media_current";
const currentKeyHash = createHash("sha256").update(currentApiKey).digest("hex");
const currentProjectId = "project_runtime_media_current";

type MediaRow = {
  projectId: string;
  originalUrl: string;
  localizedUrl: string;
  langTo: string;
};

type MediaQuery = {
  where: {
    projectId: string;
    langTo: { in: string[] };
  };
  orderBy: Array<{ langTo?: "asc"; originalUrl?: "asc" }>;
  select: {
    originalUrl: true;
    localizedUrl: true;
    langTo: true;
  };
  take: number;
};

let runtimeMediaRows: MediaRow[] = [];

const apiKeyFindUnique = test.mock.fn(async (args: {
  where: { key: string };
}) => {
  if (args.where.key !== currentKeyHash) {
    return null;
  }

  return {
    id: "api_key_runtime_media_current",
    projectId: currentProjectId,
    isActive: true,
    expiresAt: null,
    project: {
      organization: { subscription: null },
      languages: [
        { langCode: "en", isActive: true },
        { langCode: "fr", isActive: true },
        { langCode: "it", isActive: false },
      ],
      settings: null,
    },
  };
});
const apiKeyUpdate = test.mock.fn(async () => ({}));
const exclusionFindMany = test.mock.fn(async () => []);
const slugFindMany = test.mock.fn(async () => []);
const mediaFindMany = test.mock.fn(async (args: MediaQuery) =>
  runtimeMediaRows
    .filter(
      (row) =>
        row.projectId === args.where.projectId &&
        args.where.langTo.in.includes(row.langTo),
    )
    .sort(
      (first, second) =>
        first.langTo.localeCompare(second.langTo) ||
        first.originalUrl.localeCompare(second.originalUrl),
    )
    .slice(0, args.take)
    .map(({ originalUrl, localizedUrl, langTo }) => ({
      originalUrl,
      localizedUrl,
      langTo,
    })),
);
const rateLimitQuery = test.mock.fn(async () => [
  {
    scope: "plugin",
    subjectHash: "runtime-media-hash",
    count: 1,
    resetAt: new Date(Date.now() + 60_000),
  },
]);

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
  projectMediaReplacement: {
    findMany: mediaFindMany,
  },
  $queryRaw: rateLimitQuery,
};

function runtimeRequest(apiKey: string | null = currentApiKey): NextRequest {
  const url = new URL("https://deepglot.test/api/plugin/runtime-config");

  if (apiKey !== null) {
    url.searchParams.set("api_key", apiKey);
  }

  return new Request(url) as NextRequest;
}

function mediaRow(index: number, options: {
  language?: string;
  projectId?: string;
  fillerLength?: number;
} = {}): MediaRow {
  const suffix = String(index).padStart(3, "0");
  const originalFiller = "a".repeat(options.fillerLength ?? 0);
  const localizedFiller = "b".repeat(options.fillerLength ?? 0);

  return {
    projectId: options.projectId ?? currentProjectId,
    originalUrl: `/wp-content/uploads/${originalFiller}${suffix}.png`,
    localizedUrl: `/wp-content/uploads/${localizedFiller}${suffix}.webp`,
    langTo: options.language ?? "en",
  };
}

test.beforeEach(() => {
  runtimeMediaRows = [];

  for (const mock of [
    apiKeyFindUnique,
    apiKeyUpdate,
    exclusionFindMany,
    slugFindMany,
    mediaFindMany,
    rateLimitQuery,
  ]) {
    mock.mock.resetCalls();
  }
});

test("rejects missing and invalid runtime API keys before querying project images", async () => {
  const { GET } = await import("@/app/api/plugin/runtime-config/route");

  const missingResponse = await GET(runtimeRequest(null));
  const missingBody = await missingResponse.json();
  assert.equal(missingResponse.status, 401);
  assert.equal(missingBody.code, "missing_api_key");
  assert.equal(apiKeyFindUnique.mock.callCount(), 0);
  assert.equal(mediaFindMany.mock.callCount(), 0);

  const invalidResponse = await GET(runtimeRequest("dg_live_runtime_media_invalid"));
  const invalidBody = await invalidResponse.json();
  assert.equal(invalidResponse.status, 401);
  assert.equal(invalidBody.code, "invalid_api_key");
  assert.equal(apiKeyFindUnique.mock.callCount(), 1);
  assert.equal(mediaFindMany.mock.callCount(), 0);
});

test("returns compact image mappings only for the authenticated project and active languages", async () => {
  const { GET, MAX_RUNTIME_MEDIA_REPLACEMENTS } = await import(
    "@/app/api/plugin/runtime-config/route"
  );

  runtimeMediaRows = [
    {
      projectId: currentProjectId,
      originalUrl: "/wp-content/uploads/zebra.png?size=800",
      localizedUrl: "/wp-content/uploads/zebra-en.webp?size=800",
      langTo: "en",
    },
    {
      projectId: currentProjectId,
      originalUrl: "/wp-content/uploads/cover.png",
      localizedUrl: "/wp-content/uploads/cover-fr.png",
      langTo: "fr",
    },
    {
      projectId: currentProjectId,
      originalUrl: "/wp-content/uploads/cover.png",
      localizedUrl: "/wp-content/uploads/cover-en.png",
      langTo: "en",
    },
    {
      projectId: "project_runtime_media_foreign",
      originalUrl: "/wp-content/uploads/foreign.png",
      localizedUrl: "/wp-content/uploads/foreign-en.png",
      langTo: "en",
    },
    {
      projectId: currentProjectId,
      originalUrl: "/wp-content/uploads/inactive.png",
      localizedUrl: "/wp-content/uploads/inactive-it.png",
      langTo: "it",
    },
  ];

  const response = await GET(runtimeRequest());
  const body = await response.json();

  assert.equal(response.status, 200);
  assert.deepEqual(body.mediaReplacements, {
    en: {
      "/wp-content/uploads/cover.png": "/wp-content/uploads/cover-en.png",
      "/wp-content/uploads/zebra.png?size=800":
        "/wp-content/uploads/zebra-en.webp?size=800",
    },
    fr: {
      "/wp-content/uploads/cover.png": "/wp-content/uploads/cover-fr.png",
    },
  });
  assert.equal(mediaFindMany.mock.callCount(), 1);
  assert.deepEqual(mediaFindMany.mock.calls[0]?.arguments[0], {
    where: {
      projectId: currentProjectId,
      langTo: { in: ["en", "fr"] },
    },
    orderBy: [{ langTo: "asc" }, { originalUrl: "asc" }],
    select: {
      originalUrl: true,
      localizedUrl: true,
      langTo: true,
    },
    take: MAX_RUNTIME_MEDIA_REPLACEMENTS + 1,
  });
});

test("does not count inactive-language or foreign-project images toward the 500-image limit", async () => {
  const { GET, MAX_RUNTIME_MEDIA_REPLACEMENTS } = await import(
    "@/app/api/plugin/runtime-config/route"
  );

  runtimeMediaRows = [
    mediaRow(1),
    ...Array.from({ length: MAX_RUNTIME_MEDIA_REPLACEMENTS + 1 }, (_, index) =>
      mediaRow(index, { language: "it" }),
    ),
    ...Array.from({ length: MAX_RUNTIME_MEDIA_REPLACEMENTS + 1 }, (_, index) =>
      mediaRow(index, { projectId: "project_runtime_media_foreign" }),
    ),
  ];

  const response = await GET(runtimeRequest());
  const body = await response.json();

  assert.equal(response.status, 200);
  assert.deepEqual(body.mediaReplacements, {
    en: {
      "/wp-content/uploads/001.png": "/wp-content/uploads/001.webp",
    },
  });
});

test("rejects 501 active project images instead of returning a truncated mapping set", async () => {
  const { GET, MAX_RUNTIME_MEDIA_REPLACEMENTS } = await import(
    "@/app/api/plugin/runtime-config/route"
  );

  runtimeMediaRows = Array.from(
    { length: MAX_RUNTIME_MEDIA_REPLACEMENTS + 1 },
    (_, index) => mediaRow(index),
  );

  const response = await GET(runtimeRequest());
  const body = await response.json();

  assert.equal(response.status, 413);
  assert.equal(body.code, "runtime_media_replacements_limit_exceeded");
  assert.equal(body.limit, MAX_RUNTIME_MEDIA_REPLACEMENTS);
  assert.equal("mediaReplacements" in body, false);
  assert.equal(mediaFindMany.mock.calls[0]?.arguments[0].take, 501);
});

test("accepts a 500-image payload immediately below the reserved 224-KiB JSON ceiling", async () => {
  const {
    GET,
    MAX_RUNTIME_MEDIA_REPLACEMENTS,
    MAX_RUNTIME_MEDIA_REPLACEMENTS_BYTES,
  } = await import("@/app/api/plugin/runtime-config/route");

  runtimeMediaRows = Array.from(
    { length: MAX_RUNTIME_MEDIA_REPLACEMENTS },
    (_, index) => mediaRow(index, { fillerLength: 198 }),
  );
  const expected = buildRuntimeMediaReplacements(runtimeMediaRows);
  const payloadBytes = new TextEncoder().encode(JSON.stringify(expected)).length;

  assert.equal(MAX_RUNTIME_MEDIA_REPLACEMENTS_BYTES, 229_376);
  assert.ok(payloadBytes <= MAX_RUNTIME_MEDIA_REPLACEMENTS_BYTES);
  assert.ok(payloadBytes > MAX_RUNTIME_MEDIA_REPLACEMENTS_BYTES - 2_048);

  const response = await GET(runtimeRequest());
  const body = await response.json();

  assert.equal(response.status, 200);
  assert.deepEqual(body.mediaReplacements, expected);
  assert.equal(Object.keys(body.mediaReplacements.en).length, 500);
});

test("rejects a 500-image payload above the reserved 224-KiB JSON ceiling", async () => {
  const {
    GET,
    MAX_RUNTIME_MEDIA_REPLACEMENTS,
    MAX_RUNTIME_MEDIA_REPLACEMENTS_BYTES,
  } = await import("@/app/api/plugin/runtime-config/route");

  runtimeMediaRows = Array.from(
    { length: MAX_RUNTIME_MEDIA_REPLACEMENTS },
    (_, index) => mediaRow(index, { fillerLength: 199 }),
  );
  const expected = buildRuntimeMediaReplacements(runtimeMediaRows);
  const payloadBytes = new TextEncoder().encode(JSON.stringify(expected)).length;

  assert.ok(payloadBytes > MAX_RUNTIME_MEDIA_REPLACEMENTS_BYTES);

  const response = await GET(runtimeRequest());
  const body = await response.json();

  assert.equal(response.status, 413);
  assert.equal(body.code, "runtime_media_replacements_limit_exceeded");
  assert.equal(body.limit, MAX_RUNTIME_MEDIA_REPLACEMENTS_BYTES);
  assert.equal("mediaReplacements" in body, false);
});
