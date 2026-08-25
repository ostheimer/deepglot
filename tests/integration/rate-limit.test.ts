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

  const oversizedFresh = await reserve(1_200, "2026-07-13T10:00:00.000Z");
  const first = await reserve(600, "2026-07-13T10:01:00.000Z");
  const rejected = await reserve(500, "2026-07-13T10:05:00.000Z");
  const filled = await reserve(400, "2026-07-13T10:10:00.000Z");
  const released = await store.releaseBucket({
    scope,
    subjectHash,
    cost: 300,
    now: new Date("2026-07-13T10:15:00.000Z"),
    reservationResetAt: resetAt,
  });
  const oversizedExpired = await store.reserveBucket({
    scope,
    subjectHash,
    cost: 1_200,
    limit: 1_000,
    now: new Date("2026-07-13T11:01:00.000Z"),
    resetAt: new Date("2026-07-13T12:01:00.000Z"),
  });
  const nextWindow = await store.reserveBucket({
    scope,
    subjectHash,
    cost: 1_000,
    limit: 1_000,
    now: new Date("2026-07-13T11:02:00.000Z"),
    resetAt: new Date("2026-07-13T12:02:00.000Z"),
  });

  return {
    oversizedFresh,
    first,
    rejected,
    filled,
    released,
    oversizedExpired,
    nextWindow,
  };
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

  assert.equal(memoryResults.oversizedFresh.reserved, false);
  assert.equal(memoryResults.oversizedFresh.bucket.count, 0);
  assert.equal(memoryResults.oversizedExpired.reserved, false);
  assert.equal(memoryResults.oversizedExpired.bucket.count, 0);
  assert.equal(memoryResults.nextWindow.reserved, true);
  assert.equal(memoryResults.nextWindow.bucket.count, 1_000);

  assert.equal(prismaResults.oversizedFresh.reserved, false);
  assert.equal(prismaResults.oversizedFresh.bucket.count, 0);
  assert.equal(prismaResults.oversizedExpired.reserved, false);
  assert.equal(prismaResults.oversizedExpired.bucket.count, 0);
  assert.equal(prismaResults.nextWindow.reserved, true);
  assert.equal(prismaResults.nextWindow.bucket.count, 1_000);

  assert.deepEqual(
    JSON.parse(
      JSON.stringify(normalize(prismaResults)).replaceAll(
        prismaScope,
        memoryScope
      )
    ),
    normalize(memoryResults)
  );
});

test("PrismaRateLimitStore rejects oversized new and expired buckets without mutation", { skip: skipWithoutDatabase }, async () => {
  const scope = uniqueScope("oversized-no-mutation");
  const subjectHash = "oversized-subject";
  const store = new PrismaRateLimitStore();
  const { db } = await import("@/lib/db");

  const oversizedFresh = await store.reserveBucket({
    scope,
    subjectHash,
    cost: 1_200,
    limit: 1_000,
    now: new Date("2026-07-13T10:00:00.000Z"),
    resetAt: new Date("2026-07-13T11:00:00.000Z"),
  });
  assert.equal(oversizedFresh.reserved, false);
  assert.equal(oversizedFresh.bucket.count, 0);
  assert.equal(
    await db.rateLimitBucket.findUnique({
      where: { scope_subjectHash: { scope, subjectHash } },
    }),
    null
  );

  const initial = await store.reserveBucket({
    scope,
    subjectHash,
    cost: 600,
    limit: 1_000,
    now: new Date("2026-07-13T10:01:00.000Z"),
    resetAt: new Date("2026-07-13T11:00:00.000Z"),
  });
  assert.equal(initial.reserved, true);

  const oversizedExpired = await store.reserveBucket({
    scope,
    subjectHash,
    cost: 1_200,
    limit: 1_000,
    now: new Date("2026-07-13T11:01:00.000Z"),
    resetAt: new Date("2026-07-13T12:01:00.000Z"),
  });
  assert.equal(oversizedExpired.reserved, false);
  assert.equal(oversizedExpired.bucket.count, 0);
  assert.deepEqual(
    await db.rateLimitBucket.findUnique({
      where: { scope_subjectHash: { scope, subjectHash } },
      select: { count: true, resetAt: true },
    }),
    { count: 600, resetAt: new Date("2026-07-13T11:00:00.000Z") }
  );

  const validExpired = await store.reserveBucket({
    scope,
    subjectHash,
    cost: 1_000,
    limit: 1_000,
    now: new Date("2026-07-13T11:02:00.000Z"),
    resetAt: new Date("2026-07-13T12:02:00.000Z"),
  });
  assert.equal(validExpired.reserved, true);
  assert.deepEqual(
    await db.rateLimitBucket.findUnique({
      where: { scope_subjectHash: { scope, subjectHash } },
      select: { count: true, resetAt: true },
    }),
    { count: 1_000, resetAt: new Date("2026-07-13T12:02:00.000Z") }
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

test("PrismaRateLimitStore never releases an old reservation from the next window", { skip: skipWithoutDatabase }, async () => {
  const scope = uniqueScope("release-window-identity");
  const subjectHash = "release-window-subject";
  const store = new PrismaRateLimitStore();
  const oldResetAt = new Date("2026-07-13T11:00:00.000Z");
  const nextResetAt = new Date("2026-07-13T12:00:00.000Z");

  const oldReservation = await store.reserveBucket({
    scope,
    subjectHash,
    cost: 400,
    limit: 1_000,
    now: new Date("2026-07-13T10:00:00.000Z"),
    resetAt: oldResetAt,
  });
  assert.equal(oldReservation.reserved, true);

  const nextReservation = await store.reserveBucket({
    scope,
    subjectHash,
    cost: 700,
    limit: 1_000,
    now: new Date("2026-07-13T11:01:00.000Z"),
    resetAt: nextResetAt,
  });
  assert.equal(nextReservation.reserved, true);
  assert.equal(nextReservation.bucket.count, 700);

  const staleRelease = await store.releaseBucket({
    scope,
    subjectHash,
    cost: 400,
    now: new Date("2026-07-13T11:02:00.000Z"),
    reservationResetAt: oldResetAt,
  });
  assert.equal(staleRelease, null);

  const { db } = await import("@/lib/db");
  assert.deepEqual(
    await db.rateLimitBucket.findUnique({
      where: { scope_subjectHash: { scope, subjectHash } },
      select: { count: true, resetAt: true },
    }),
    { count: 700, resetAt: nextResetAt },
  );
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
