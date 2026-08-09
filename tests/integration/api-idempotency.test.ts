import assert from "node:assert/strict";
import { after, test } from "node:test";

import {
  PrismaApiIdempotencyStore,
  executeIdempotently,
  hashApiIdempotencyKey,
  hashApiIdempotencyRequestBody,
  pruneExpiredApiIdempotencyRecords,
} from "@/lib/api-idempotency";
import { resolveDatabaseUrl } from "@/lib/database-url";

const scopesToDelete = new Set<string>();
const databaseUrl = resolveDatabaseUrl();
const skipWithoutDatabase = databaseUrl
  ? false
  : "requires a prepared PostgreSQL database via DATABASE_URL or DEEPGLOT_DATABASE_URL";

function uniqueScope(label: string) {
  const scope = `integration:idempotency:${label}:${crypto.randomUUID()}`;
  scopesToDelete.add(scope);
  return scope;
}

test(
  "PrismaApiIdempotencyStore atomically coalesces provider and usage side effects",
  { skip: skipWithoutDatabase },
  async () => {
    const store = new PrismaApiIdempotencyStore();
    const scope = uniqueScope("concurrent");
    const key = `raw-key-${crypto.randomUUID()}`;
    const requestBody = {
      l_from: "de",
      l_to: "en",
      words: [{ w: `Sensitive-${crypto.randomUUID()}`, t: 1 }],
    };
    let providerCalls = 0;
    let usageIncrements = 0;

    const results = await Promise.all(
      Array.from({ length: 12 }, () =>
        executeIdempotently({
          scope,
          key,
          requestBody,
          store,
          execute: async () => {
            providerCalls += 1;
            usageIncrements += 1;
            await new Promise((resolve) => setTimeout(resolve, 75));
            return {
              status: 200,
              headers: { "content-type": "application/json" },
              body: { ok: true },
            };
          },
        }),
      ),
    );

    assert.equal(results.filter((result) => result.kind === "executed").length, 1);
    assert.equal(results.filter((result) => result.kind === "replayed").length, 11);
    assert.equal(providerCalls, 1);
    assert.equal(usageIncrements, 1);

    const { db } = await import("@/lib/db");
    const persisted = await db.apiIdempotencyRecord.findUnique({
      where: { scope_keyHash: { scope, keyHash: hashApiIdempotencyKey(key) } },
      select: {
        keyHash: true,
        requestHash: true,
        responseStatus: true,
        responseBody: true,
      },
    });
    assert.deepEqual(persisted, {
      keyHash: hashApiIdempotencyKey(key),
      requestHash: hashApiIdempotencyRequestBody(requestBody),
      responseStatus: 200,
      responseBody: '{"ok":true}',
    });
    assert.ok(!JSON.stringify(persisted).includes(key));
    assert.ok(!JSON.stringify(persisted).includes(requestBody.words[0].w));

    const conflict = await executeIdempotently({
      scope,
      key,
      requestBody: { ...requestBody, l_to: "fr" },
      store,
      execute: async () => {
        throw new Error("conflicting body must not execute");
      },
    });
    assert.deepEqual(conflict, { kind: "conflict" });
  },
);

test(
  "scheduled cleanup physically removes expired Prisma idempotency records",
  { skip: skipWithoutDatabase },
  async () => {
    const store = new PrismaApiIdempotencyStore();
    const scope = uniqueScope("cleanup");
    const key = `cleanup-${crypto.randomUUID()}`;

    await executeIdempotently({
      scope,
      key,
      requestBody: { words: [{ w: "Cleanup", t: 1 }] },
      store,
      now: new Date("2026-07-12T10:00:00Z"),
      retentionMs: 1_000,
      execute: async () => ({
        status: 200,
        headers: { "content-type": "application/json" },
        body: { ok: true },
      }),
    });

    assert.equal(
      await pruneExpiredApiIdempotencyRecords(
        new Date("2026-07-12T10:00:02Z"),
      ),
      1,
    );

    const { db } = await import("@/lib/db");
    assert.equal(
      await db.apiIdempotencyRecord.count({ where: { scope } }),
      0,
    );
  },
);

test(
  "Prisma idempotency deduplicates retryable 429 until reset and retains deterministic oversize",
  { skip: skipWithoutDatabase },
  async () => {
    const store = new PrismaApiIdempotencyStore();
    const scope = uniqueScope("retryable-429");
    const key = `retryable-${crypto.randomUUID()}`;
    const requestBody = { words: [{ w: "Retry later", t: 1 }] };
    let retryableExecutions = 0;
    const windowStart = new Date();

    const request = {
      scope,
      key,
      requestBody,
      store,
      responseRetentionMs: (response: { status: number }) =>
        response.status === 429 ? 3_600_000 : 24 * 60 * 60 * 1_000,
      execute: async () => {
        retryableExecutions += 1;
        return {
          status: 429,
          headers: { "retry-after": "3600" },
          body: { code: "velocity_limited", retry_after: 3_600 },
        };
      },
    };

    const first = await executeIdempotently({ ...request, now: windowStart });
    const beforeReset = await executeIdempotently({
      ...request,
      now: new Date(windowStart.getTime() + 3_599_000),
    });
    const { db } = await import("@/lib/db");
    const storedBeforeReset = await db.apiIdempotencyRecord.findUnique({
      where: {
        scope_keyHash: { scope, keyHash: hashApiIdempotencyKey(key) },
      },
      select: { responseHeaders: true, responseBody: true },
    });
    const afterReset = await executeIdempotently({
      ...request,
      now: new Date(windowStart.getTime() + 3_601_000),
    });
    assert.equal(first.kind, "executed");
    assert.equal(beforeReset.kind, "replayed");
    assert.equal(beforeReset.response.headers["retry-after"], "1");
    assert.deepEqual(beforeReset.response.body, {
      code: "velocity_limited",
      retry_after: 1,
    });
    assert.equal(
      (storedBeforeReset?.responseHeaders as Record<string, string>)["retry-after"],
      "3600",
      "the Prisma replay must not mutate its stored response headers",
    );
    assert.equal(
      JSON.parse(storedBeforeReset?.responseBody ?? "null").retry_after,
      3_600,
      "the Prisma replay must not mutate its stored response body",
    );
    assert.equal(afterReset.kind, "executed");
    assert.equal(retryableExecutions, 2);

    assert.equal(
      await db.apiIdempotencyRecord.count({ where: { scope } }),
      1,
      "the refreshed retryable response remains deduplicated until its next reset",
    );

    const oversizeScope = uniqueScope("oversize-422");
    let oversizeExecutions = 0;
    const oversizeRequest = {
      ...request,
      scope: oversizeScope,
      key: `oversize-${crypto.randomUUID()}`,
      execute: async () => {
        oversizeExecutions += 1;
        return {
          status: 422,
          headers: { "content-type": "application/problem+json" },
          body: { code: "velocity_request_too_large" },
        };
      },
    };
    assert.equal((await executeIdempotently(oversizeRequest)).kind, "executed");
    assert.equal((await executeIdempotently(oversizeRequest)).kind, "replayed");
    assert.equal(oversizeExecutions, 1);
  },
);

after(async () => {
  if (scopesToDelete.size > 0 && databaseUrl) {
    const { db } = await import("@/lib/db");
    await db.apiIdempotencyRecord.deleteMany({
      where: { scope: { in: [...scopesToDelete] } },
    });
    await db.$disconnect();
  }
});
