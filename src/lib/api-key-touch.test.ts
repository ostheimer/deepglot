import assert from "node:assert/strict";
import test from "node:test";
import type { PrismaClient } from "@prisma/client";

// Install a fully local DB double before importing the production auth function.
const now = new Date("2026-10-19T12:00:00Z");
const interval = 5 * 60_000;
const row = { id: "key-test", isActive: true, expiresAt: null as Date | null,
  lastUsedAt: null as Date | null, project: { id: "project-test" } };
let writes: unknown[] = [];
let reads = 0;
let failWrite = false;
let missingKey = false;
let affectedRows: number[] = [];
type TouchArgs = {
  where: { id: string; OR: { lastUsedAt: null | { lte: Date } }[] };
  data: { lastUsedAt: Date };
};
const fakeDb = { apiKey: {
  findUnique: async () => { reads++; return missingKey ? null : { ...row }; },
  update: async (args: unknown) => { writes.push(args); return row; },
  updateMany: async (args: TouchArgs) => {
    writes.push(args); if (failWrite) throw new Error("local write failure");
    // Evaluate the conditional write against current storage, not the read snapshot.
    const matches = args.where.id === row.id && args.where.OR.some(({ lastUsedAt }) =>
      lastUsedAt === null
        ? row.lastUsedAt === null
        : row.lastUsedAt !== null && row.lastUsedAt <= lastUsedAt.lte);
    const count = matches ? 1 : 0;
    if (matches) row.lastUsedAt = args.data.lastUsedAt;
    affectedRows.push(count);
    return { count };
  },
} };
(globalThis as unknown as { prisma: PrismaClient }).prisma = fakeDb as unknown as PrismaClient;
const apiKeys = import("./api-keys");
async function validateApiKey(key: string) { return (await apiKeys).validateApiKey(key); }

function reset() { row.isActive = true; row.expiresAt = null; row.lastUsedAt = null;
  writes = []; reads = 0; failWrite = false; missingKey = false; affectedRows = []; }

test("100 recent key validations read current permissions but do not rewrite lastUsedAt", async (t) => {
  reset(); t.mock.timers.enable({ apis: ["Date"], now });
  row.lastUsedAt = new Date(now.getTime() - interval + 1);
  for (let i = 0; i < 100; i++) assert.ok(await validateApiKey("local-test-key"));
  assert.equal(reads, 100, "Never cache authorization/revocation state");
  assert.equal(writes.length, 0);
});

test("first use touches once and stale-use writes have a cross-instance DB guard", async (t) => {
  reset(); t.mock.timers.enable({ apis: ["Date"], now });
  for (let i = 0; i < 100; i++) await validateApiKey("local-test-key");
  assert.equal(writes.length, 1);
  assert.deepEqual(writes[0], { where: { id: row.id, OR: [
    { lastUsedAt: null }, { lastUsedAt: { lte: new Date(now.getTime() - interval) } },
  ] }, data: { lastUsedAt: now } });
});

test("the five-minute boundary refreshes while future timestamps are not overwritten", async (t) => {
  reset(); t.mock.timers.enable({ apis: ["Date"], now });
  row.lastUsedAt = new Date(now.getTime() - interval);
  await validateApiKey("local-test-key"); assert.equal(writes.length, 1);
  row.lastUsedAt = new Date(now.getTime() + interval); writes = [];
  await validateApiKey("local-test-key"); assert.equal(writes.length, 0);
});

test("revoked or expired keys are rejected immediately without activity writes", async (t) => {
  reset(); t.mock.timers.enable({ apis: ["Date"], now });
  row.isActive = false;
  assert.equal(await validateApiKey("local-test-key"), null);
  row.isActive = true; row.expiresAt = new Date(now.getTime() - 1);
  assert.equal(await validateApiKey("local-test-key"), null);
  assert.equal(writes.length, 0);
});

test("activity write errors do not turn valid auth into an error", async (t) => {
  reset(); t.mock.timers.enable({ apis: ["Date"], now }); failWrite = true;
  assert.ok(await validateApiKey("local-test-key"));
  assert.equal(writes.length, 1, "Exercise the failed write path");
  assert.equal(row.lastUsedAt, null);
  failWrite = false;
  assert.ok(await validateApiKey("local-test-key"));
  assert.equal(reads, 2);
  assert.equal(writes.length, 2, "A failed timestamp write must remain retryable");
  assert.deepEqual(row.lastUsedAt, now);
});

for (const initialTimestamp of [null, new Date(now.getTime() - interval)]) {
  test(`concurrent ${initialTimestamp === null ? "first" : "stale"} uses only update one stored timestamp`, async (t) => {
    reset(); t.mock.timers.enable({ apis: ["Date"], now });
    row.lastUsedAt = initialTimestamp;
    // Each async read snapshots the stale row before any validation can write.
    const results = await Promise.all(Array.from({ length: 100 }, () => validateApiKey("local-test-key")));
    assert.ok(results.every((result) => result !== null));
    assert.ok(results.every((result) => result?.lastUsedAt === initialTimestamp));
    assert.equal(reads, 100);
    assert.equal(writes.length, 100, "All stale readers must reach the database guard");
    assert.equal(affectedRows.filter((count) => count === 1).length, 1);
    assert.equal(affectedRows.filter((count) => count === 0).length, 99);
    assert.deepEqual(row.lastUsedAt, now);
  });
}

test("a recently used key still observes revocation, expiry, and deletion on every read", async (t) => {
  reset(); t.mock.timers.enable({ apis: ["Date"], now });
  row.lastUsedAt = now;
  assert.ok(await validateApiKey("local-test-key"));
  row.isActive = false;
  assert.equal(await validateApiKey("local-test-key"), null);
  row.isActive = true;
  row.expiresAt = new Date(now.getTime() - 1);
  assert.equal(await validateApiKey("local-test-key"), null);
  row.expiresAt = null;
  missingKey = true;
  assert.equal(await validateApiKey("local-test-key"), null);
  assert.equal(reads, 4);
  assert.equal(writes.length, 0);
});
