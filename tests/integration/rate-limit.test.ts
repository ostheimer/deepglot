import assert from "node:assert/strict";
import { after, test } from "node:test";

import { resolveDatabaseUrl } from "@/lib/database-url";
import {
  MemoryRateLimitStore,
  PrismaRateLimitStore,
  type RateLimitStore,
} from "@/lib/rate-limit";

const scopesToDelete = new Set<string>();
const databaseUrl = resolveDatabaseUrl();
const skipWithoutDatabase = databaseUrl
  ? false
  : "requires a prepared PostgreSQL database via DATABASE_URL or DEEPGLOT_DATABASE_URL";

function uniqueScope(label: string) {
  const scope = `integration:${label}:${crypto.randomUUID()}`;
  scopesToDelete.add(scope);
  return scope;
}

async function exerciseReservationSequence(store: RateLimitStore, scope: string) {
  const subjectHash = "integration-subject";
  const resetAt = new Date("2026-07-13T11:00:00.000Z");
  const reserve = (cost: number, now: string) =>
    store.reserveBucket({
      scope,
      subjectHash,
      cost,
      limit: 1_000,
      now: new Date(now),
      resetAt,
    });

  const first = await reserve(600, "2026-07-13T10:00:00.000Z");
  const rejected = await reserve(500, "2026-07-13T10:05:00.000Z");
  const filled = await reserve(400, "2026-07-13T10:10:00.000Z");
  const released = await store.releaseBucket({
    scope,
    subjectHash,
    cost: 300,
    now: new Date("2026-07-13T10:15:00.000Z"),
  });
  const nextWindow = await store.reserveBucket({
    scope,
    subjectHash,
    cost: 1_200,
    limit: 1_000,
    now: new Date("2026-07-13T11:01:00.000Z"),
    resetAt: new Date("2026-07-13T12:01:00.000Z"),
  });

  return [first, rejected, filled, released, nextWindow];
}

function normalize(value: unknown) {
  return JSON.parse(JSON.stringify(value));
}

test("MemoryRateLimitStore and PrismaRateLimitStore preserve identical reservation semantics", { skip: skipWithoutDatabase }, async () => {
  const memoryScope = uniqueScope("parity-memory");
  const prismaScope = uniqueScope("parity-prisma");

  const memoryResults = await exerciseReservationSequence(
    new MemoryRateLimitStore(),
    memoryScope
  );
  const prismaResults = await exerciseReservationSequence(
    new PrismaRateLimitStore(),
    prismaScope
  );

  assert.deepEqual(
    normalize(prismaResults).map((result: unknown) =>
      JSON.parse(JSON.stringify(result).replaceAll(prismaScope, memoryScope))
    ),
    normalize(memoryResults)
  );
});

test("PrismaRateLimitStore atomically prevents concurrent reservations from exceeding the cap", { skip: skipWithoutDatabase }, async () => {
  const scope = uniqueScope("concurrent");
  const subjectHash = "concurrent-subject";
  const store = new PrismaRateLimitStore();

  const results = await Promise.all(
    Array.from({ length: 20 }, () =>
      store.reserveBucket({
        scope,
        subjectHash,
        cost: 10,
        limit: 100,
        now: new Date("2026-07-13T10:00:00.000Z"),
        resetAt: new Date("2026-07-13T11:00:00.000Z"),
      })
    )
  );

  assert.equal(results.filter((result) => result.reserved).length, 10);
  const { db } = await import("@/lib/db");
  const persisted = await db.rateLimitBucket.findUnique({
    where: { scope_subjectHash: { scope, subjectHash } },
    select: { count: true },
  });
  assert.deepEqual(persisted, { count: 100 });
});

after(async () => {
  if (scopesToDelete.size > 0) {
    const { db } = await import("@/lib/db");
    await db.rateLimitBucket.deleteMany({
      where: { scope: { in: [...scopesToDelete] } },
    });
    await db.$disconnect();
  }
});
