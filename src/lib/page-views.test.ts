import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";

import { Prisma } from "@prisma/client";
import type { NextRequest } from "next/server";

import {
  PAGE_VIEW_MAX_URL_PATH_LENGTH,
  PAGE_VIEW_RATE_LIMIT_SCOPE,
  PAGE_VIEW_RETENTION_DAYS,
  getPageViewRateLimitPerMinute,
  getPageViewRetentionCutoff,
  isPageViewBot,
  normalizePageViewPath,
  pageViewEventSchema,
} from "@/lib/page-views";
import { PLUGIN_RATE_LIMIT_SCOPE } from "@/lib/rate-limit";

const validEventId = "32cc99e2-d9d3-4ed7-9137-6bd38f3181cf";
const validApiKey = "dg_live_page_view_test_key";
const validKeyHash = createHash("sha256").update(validApiKey).digest("hex");

let pageViewsEnabled = true;
let pageViewsConsentGrantedAt: Date | null = new Date("2026-08-25T10:00:00.000Z");
let projectId = "project-current";
let rateLimitCount = 1;

type RecordedEvent = {
  eventId: string;
  urlPath: string;
  langTo: string;
  projectId: string;
  createdAt?: Date;
};

const recordedEvents = new Map<string, RecordedEvent>();

const apiKeyFindUnique = test.mock.fn(async (args: {
  where: { key: string };
}) => {
  if (args.where.key !== validKeyHash) {
    return null;
  }

  return {
    id: "api-key-current",
    projectId,
    isActive: true,
    expiresAt: null,
    project: {
      id: projectId,
      name: "Page-view project",
      domain: "example.test",
      originalLang: "de",
      updatedAt: new Date("2026-08-25T10:00:00.000Z"),
      organization: { subscription: null },
      languages: [
        { langCode: "en", isActive: true },
        { langCode: "fr", isActive: false },
      ],
      settings: { pageViewsEnabled, pageViewsConsentGrantedAt },
    },
  };
});
const apiKeyUpdate = test.mock.fn(async () => ({}));
const pageViewCreate = test.mock.fn(async (args: { data: RecordedEvent }) => {
  if (recordedEvents.has(args.data.eventId)) {
    throw new Prisma.PrismaClientKnownRequestError("Duplicate event ID", {
      code: "P2002",
      clientVersion: "test",
      meta: { target: ["eventId"] },
    });
  }

  recordedEvents.set(args.data.eventId, args.data);
  return { id: "page-view-current", ...args.data };
});
const pageViewFindUnique = test.mock.fn(async (args: {
  where: { eventId: string };
}) => {
  const event = recordedEvents.get(args.where.eventId);
  return event ? { projectId: event.projectId } : null;
});
const pageViewDeleteMany = test.mock.fn(async (args: {
  where: { createdAt: { lt: Date } };
}) => {
  assert.ok(args.where.createdAt.lt instanceof Date);
  return { count: 3 };
});
const exclusionFindMany = test.mock.fn(async () => []);
const slugFindMany = test.mock.fn(async () => []);
const rateLimitQuery = test.mock.fn(async (...queryArguments: unknown[]) => {
  assert.ok(queryArguments.length > 0);

  return [{
    scope: PAGE_VIEW_RATE_LIMIT_SCOPE,
    subjectHash: "privacy-preserving-hash",
    count: rateLimitCount,
    resetAt: new Date(Date.now() + 60_000),
  }];
});

(globalThis as unknown as { prisma: unknown }).prisma = {
  apiKey: {
    findUnique: apiKeyFindUnique,
    update: apiKeyUpdate,
  },
  pageView: {
    create: pageViewCreate,
    findUnique: pageViewFindUnique,
    deleteMany: pageViewDeleteMany,
  },
  translationExclusion: {
    findMany: exclusionFindMany,
  },
  urlSlug: {
    findMany: slugFindMany,
  },
  $queryRaw: rateLimitQuery,
};

function collectorRequest(
  body: unknown,
  options: {
    authorization?: string | null;
    userAgent?: string;
    url?: string;
    contentLength?: string;
    rawBody?: string;
  } = {},
): NextRequest {
  const headers = new Headers({ "content-type": "application/json" });

  if (options.authorization !== null) {
    headers.set(
      "authorization",
      options.authorization ?? `Bearer ${validApiKey}`,
    );
  }

  if (options.userAgent) {
    headers.set("user-agent", options.userAgent);
  }

  if (options.contentLength) {
    headers.set("content-length", options.contentLength);
  }

  return new Request(
    options.url ?? "https://deepglot.test/api/plugin/page-views",
    {
      method: "POST",
      headers,
      body: options.rawBody ?? JSON.stringify(body),
    },
  ) as NextRequest;
}

function validEvent(overrides: Record<string, unknown> = {}) {
  return {
    eventId: validEventId,
    urlPath: "/en/about-us",
    langTo: "en",
    ...overrides,
  };
}

test.beforeEach(() => {
  pageViewsEnabled = true;
  pageViewsConsentGrantedAt = new Date("2026-08-25T10:00:00.000Z");
  projectId = "project-current";
  rateLimitCount = 1;
  recordedEvents.clear();

  for (const mock of [
    apiKeyFindUnique,
    apiKeyUpdate,
    pageViewCreate,
    pageViewFindUnique,
    pageViewDeleteMany,
    exclusionFindMany,
    slugFindMany,
    rateLimitQuery,
  ]) {
    mock.mock.resetCalls();
  }
});

test("page views retain only normalized paths for the documented 90-day period", () => {
  const now = new Date("2026-08-25T10:30:00.000Z");

  assert.equal(PAGE_VIEW_RETENTION_DAYS, 90);
  assert.equal(
    getPageViewRetentionCutoff(now).toISOString(),
    "2026-05-27T10:30:00.000Z",
  );
  assert.equal(normalizePageViewPath("/en/company/../about-us"), "/en/about-us");
  assert.equal(normalizePageViewPath("/en/über-uns"), "/en/%C3%BCber-uns");
});

test("page-view payloads reject personal-data fields, query strings, invalid URLs and malformed UUIDs", () => {
  assert.deepEqual(pageViewEventSchema.parse(validEvent()), validEvent());

  const rejectedEvents = [
    validEvent({ eventId: "not-a-uuid" }),
    validEvent({ urlPath: "/en/about?email=private@example.test" }),
    validEvent({ urlPath: "/en/about#private-fragment" }),
    validEvent({ urlPath: "https://example.test/en/about" }),
    validEvent({ urlPath: "//example.test/en/about" }),
    validEvent({ urlPath: "/en\\private" }),
    validEvent({ urlPath: "/en/\nprivate" }),
    validEvent({ urlPath: `/${"a".repeat(PAGE_VIEW_MAX_URL_PATH_LENGTH)}` }),
    validEvent({ langTo: "english" }),
    validEvent({ ipAddress: "203.0.113.5" }),
    validEvent({ userAgent: "Mozilla/5.0" }),
    validEvent({ visitorId: "tracking-cookie" }),
    validEvent({ referrer: "https://private.example/path?token=secret" }),
  ];

  for (const payload of rejectedEvents) {
    assert.equal(
      pageViewEventSchema.safeParse(payload).success,
      false,
      `Unexpectedly accepted privacy-unsafe event: ${JSON.stringify(payload)}`,
    );
  }
});

test("obvious crawlers are ignored without rejecting ordinary browsers or WordPress forwarding", () => {
  for (const userAgent of [
    "Googlebot/2.1 (+http://www.google.com/bot.html)",
    "bingbot/2.0",
    "DuckDuckBot/1.1",
    "facebookexternalhit/1.1",
    "curl/8.7.1",
    "python-requests/2.32.0",
    "HeadlessChrome/131.0.0.0",
  ]) {
    assert.equal(isPageViewBot(userAgent), true, userAgent);
  }

  assert.equal(isPageViewBot("Mozilla/5.0 Chrome/131.0.0.0 Safari/537.36"), false);
  assert.equal(isPageViewBot("WordPress/6.8; https://example.test"), false);
  assert.equal(isPageViewBot(null), false);
});

test("page views use a separate configurable rate-limit bucket", () => {
  assert.notEqual(PAGE_VIEW_RATE_LIMIT_SCOPE, PLUGIN_RATE_LIMIT_SCOPE);
  assert.equal(getPageViewRateLimitPerMinute({}), 600);
  assert.equal(
    getPageViewRateLimitPerMinute({ PAGE_VIEW_RATE_LIMIT_PER_MINUTE: "900" }),
    900,
  );
  assert.equal(
    getPageViewRateLimitPerMinute({ PAGE_VIEW_RATE_LIMIT_PER_MINUTE: "0" }),
    600,
  );
  assert.equal(
    getPageViewRateLimitPerMinute({ PAGE_VIEW_RATE_LIMIT_PER_MINUTE: "invalid" }),
    600,
  );
});

test("page-view ingestion accepts only authenticated bearer API keys", async () => {
  const { POST } = await import("@/app/api/plugin/page-views/route");

  const missingResponse = await POST(
    collectorRequest(validEvent(), { authorization: null }),
  );
  assert.equal(missingResponse.status, 401);
  assert.equal((await missingResponse.json()).code, "missing_api_key");

  const queryResponse = await POST(
    collectorRequest(validEvent(), {
      authorization: null,
      url: `https://deepglot.test/api/plugin/page-views?api_key=${validApiKey}`,
    }),
  );
  assert.equal(queryResponse.status, 401);

  const invalidResponse = await POST(
    collectorRequest(validEvent(), { authorization: "Bearer dg_live_invalid" }),
  );
  assert.equal(invalidResponse.status, 401);
  assert.equal((await invalidResponse.json()).code, "invalid_api_key");
  assert.equal(pageViewCreate.mock.callCount(), 0);
});

test("disabled projects and obvious bots never create a page-view event or rate-limit bucket", async () => {
  const { POST } = await import("@/app/api/plugin/page-views/route");

  pageViewsEnabled = false;
  const disabledResponse = await POST(collectorRequest(validEvent()));
  assert.equal(disabledResponse.status, 200);
  assert.deepEqual(await disabledResponse.json(), {
    tracked: false,
    reason: "disabled",
  });
  assert.equal(pageViewCreate.mock.callCount(), 0);
  assert.equal(rateLimitQuery.mock.callCount(), 0);

  pageViewsEnabled = true;
  const botResponse = await POST(
    collectorRequest(validEvent(), { userAgent: "Googlebot/2.1" }),
  );
  assert.equal(botResponse.status, 200);
  assert.deepEqual(await botResponse.json(), {
    tracked: false,
    reason: "bot",
  });
  assert.equal(pageViewCreate.mock.callCount(), 0);
  assert.equal(rateLimitQuery.mock.callCount(), 0);
});

test("legacy enabled flags never collect real visitor data without fresh explicit consent", async () => {
  const [{ POST }, { GET }] = await Promise.all([
    import("@/app/api/plugin/page-views/route"),
    import("@/app/api/plugin/runtime-config/route"),
  ]);

  pageViewsEnabled = true;
  pageViewsConsentGrantedAt = null;

  const collectorResponse = await POST(collectorRequest(validEvent()));
  assert.equal(collectorResponse.status, 200);
  assert.deepEqual(await collectorResponse.json(), {
    tracked: false,
    reason: "disabled",
  });
  assert.equal(pageViewCreate.mock.callCount(), 0);
  assert.equal(rateLimitQuery.mock.callCount(), 0);

  const runtimeResponse = await GET(
    new Request("https://deepglot.test/api/plugin/runtime-config", {
      headers: { authorization: `Bearer ${validApiKey}` },
    }) as NextRequest,
  );
  assert.equal(runtimeResponse.status, 200);
  assert.equal((await runtimeResponse.json()).pageViewsEnabled, false);
  assert.equal(pageViewCreate.mock.callCount(), 0);
});

test("ingestion validates JSON, bounded body size, active project languages and minimal payloads", async () => {
  const { POST } = await import("@/app/api/plugin/page-views/route");

  const malformedResponse = await POST(
    collectorRequest({}, { rawBody: "{malformed" }),
  );
  assert.equal(malformedResponse.status, 400);

  const oversizedResponse = await POST(
    collectorRequest(validEvent(), { contentLength: "4097" }),
  );
  assert.equal(oversizedResponse.status, 413);

  const hiddenOversizedResponse = await POST(
    collectorRequest({}, {
      rawBody: JSON.stringify({
        ...validEvent(),
        visitorId: "a".repeat(4_097),
      }),
    }),
  );
  assert.equal(hiddenOversizedResponse.status, 413);

  const inactiveResponse = await POST(
    collectorRequest(validEvent({ langTo: "fr" })),
  );
  assert.equal(inactiveResponse.status, 400);
  assert.equal((await inactiveResponse.json()).code, "validation_failed");

  const unsafeResponse = await POST(
    collectorRequest(validEvent({ urlPath: "/en/private?token=secret" })),
  );
  assert.equal(unsafeResponse.status, 400);
  assert.equal(pageViewCreate.mock.callCount(), 0);
});

test("ingestion records only project-scoped real views and deduplicates exact event retries", async () => {
  const { POST } = await import("@/app/api/plugin/page-views/route");

  const firstResponse = await POST(
    collectorRequest(validEvent({ urlPath: "/en/company/../about-us" })),
  );
  assert.equal(firstResponse.status, 201);
  assert.deepEqual(await firstResponse.json(), { tracked: true });
  assert.deepEqual(recordedEvents.get(validEventId), {
    eventId: validEventId,
    urlPath: "/en/about-us",
    langTo: "en",
    projectId: "project-current",
  });

  const duplicateResponse = await POST(collectorRequest(validEvent()));
  assert.equal(duplicateResponse.status, 200);
  assert.deepEqual(await duplicateResponse.json(), {
    tracked: false,
    reason: "duplicate",
  });
  assert.equal(recordedEvents.size, 1);

  projectId = "another-project";
  const collisionResponse = await POST(collectorRequest(validEvent()));
  assert.equal(collisionResponse.status, 409);
  assert.equal((await collisionResponse.json()).code, "event_id_conflict");
  assert.equal(recordedEvents.size, 1);
});

test("the dedicated page-view rate limit blocks storage without consuming plugin-sync quota", async () => {
  const { POST } = await import("@/app/api/plugin/page-views/route");

  rateLimitCount = 601;
  const response = await POST(collectorRequest(validEvent()));
  const body = await response.json();

  assert.equal(response.status, 429);
  assert.equal(body.code, "rate_limit_exceeded");
  assert.equal(response.headers.get("X-RateLimit-Limit"), "600");
  assert.equal(pageViewCreate.mock.callCount(), 0);

  const queryArguments = rateLimitQuery.mock.calls[0]?.arguments ?? [];
  assert.equal(queryArguments.includes(PAGE_VIEW_RATE_LIMIT_SCOPE), true);
  assert.equal(queryArguments.includes("project-current"), false);
});

test("runtime configuration propagates the explicit page-view opt-in and defaults closed", async () => {
  const { GET } = await import("@/app/api/plugin/runtime-config/route");

  pageViewsEnabled = false;
  const disabledResponse = await GET(
    new Request("https://deepglot.test/api/plugin/runtime-config", {
      headers: { authorization: `Bearer ${validApiKey}` },
    }) as NextRequest,
  );
  assert.equal(disabledResponse.status, 200);
  assert.equal((await disabledResponse.json()).pageViewsEnabled, false);

  pageViewsEnabled = true;
  const enabledResponse = await GET(
    new Request("https://deepglot.test/api/plugin/runtime-config", {
      headers: { authorization: `Bearer ${validApiKey}` },
    }) as NextRequest,
  );
  assert.equal(enabledResponse.status, 200);
  assert.equal((await enabledResponse.json()).pageViewsEnabled, true);
});

test("the scheduled cleanup requires cron authorization and deletes only expired events", async () => {
  const previousCronSecret = process.env.CRON_SECRET;
  process.env.CRON_SECRET = "page-view-retention-test-secret";

  try {
    const { GET } = await import("@/app/api/cron/page-view-retention/route");
    const unauthorized = await GET(
      new Request("https://deepglot.test/api/cron/page-view-retention") as NextRequest,
    );
    assert.equal(unauthorized.status, 401);
    assert.equal(pageViewDeleteMany.mock.callCount(), 0);

    const before = Date.now() - PAGE_VIEW_RETENTION_DAYS * 86_400_000;
    const authorized = await GET(
      new Request("https://deepglot.test/api/cron/page-view-retention", {
        headers: {
          authorization: "Bearer page-view-retention-test-secret",
        },
      }) as NextRequest,
    );
    const after = Date.now() - PAGE_VIEW_RETENTION_DAYS * 86_400_000;
    const body = await authorized.json();

    assert.equal(authorized.status, 200);
    assert.equal(body.ok, true);
    assert.equal(body.deleted, 3);
    assert.equal(body.retentionDays, 90);

    const cutoff = pageViewDeleteMany.mock.calls[0]?.arguments[0]?.where
      ?.createdAt?.lt as Date;
    assert.ok(cutoff instanceof Date);
    assert.ok(cutoff.getTime() >= before && cutoff.getTime() <= after);
  } finally {
    if (previousCronSecret === undefined) {
      delete process.env.CRON_SECRET;
    } else {
      process.env.CRON_SECRET = previousCronSecret;
    }
  }
});
