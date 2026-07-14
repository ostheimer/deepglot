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

after(async () => {
  if (scopesToDelete.size > 0 && databaseUrl) {
    const { db } = await import("@/lib/db");
    await db.apiIdempotencyRecord.deleteMany({
      where: { scope: { in: [...scopesToDelete] } },
    });
    await db.$disconnect();
  }
});
