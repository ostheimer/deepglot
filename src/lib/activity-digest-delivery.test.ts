import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

import { Prisma } from "@prisma/client";

process.env.DATABASE_URL ??=
  "postgresql://unit-test:unit-test@127.0.0.1:5432/deepglot";

const deliveryModule = import("@/lib/activity-digest-delivery");

test("organization managers see all projects while members see only explicit project memberships", async () => {
  const { projectIdsForDigestRecipient } = await deliveryModule;
  const projects = [
    { id: "project-a", organizationId: "org-a" },
    { id: "project-b", organizationId: "org-a" },
    { id: "project-c", organizationId: "org-b" },
  ];

  assert.deepEqual(
    projectIdsForDigestRecipient(
      {
        organizationId: "org-a",
        organizationRole: "OWNER",
        projectIds: [],
      },
      projects,
    ),
    ["project-a", "project-b"],
  );
  assert.deepEqual(
    projectIdsForDigestRecipient(
      {
        organizationId: "org-a",
        organizationRole: "ADMIN",
        projectIds: ["project-c"],
      },
      projects,
    ),
    ["project-a", "project-b"],
  );
  assert.deepEqual(
    projectIdsForDigestRecipient(
      {
        organizationId: "org-a",
        organizationRole: "MEMBER",
        projectIds: ["project-b", "project-c"],
      },
      projects,
    ),
    ["project-b"],
  );
});

test("atomically reclaims only a stale unsent claim and returns a lease token", async () => {
  const { ACTIVITY_DIGEST_CLAIM_TTL_MS, acquireActivityDigestClaim } =
    await deliveryModule;
  const now = new Date("2026-08-03T08:30:00.000Z");
  const uniqueError = new Prisma.PrismaClientKnownRequestError("duplicate", {
    code: "P2002",
    clientVersion: "test",
  });
  const reclaimCalls: Array<{ staleBefore: Date; claimedAt: Date }> = [];

  const claim = await acquireActivityDigestClaim(
    {
      organizationId: "org-a",
      recipientUserId: "user-a",
      periodStart: new Date("2026-07-27T00:00:00.000Z"),
      periodEnd: new Date("2026-08-03T00:00:00.000Z"),
    },
    now,
    {
      create: async () => {
        throw uniqueError;
      },
      reclaim: async ({ staleBefore, claimedAt }) => {
        reclaimCalls.push({ staleBefore, claimedAt });
        return { id: "claim-a", claimedAt };
      },
    },
  );

  assert.deepEqual(claim, { id: "claim-a", claimedAt: now });
  assert.equal(reclaimCalls.length, 1);
  assert.equal(
    reclaimCalls[0]?.staleBefore.toISOString(),
    new Date(now.getTime() - ACTIVITY_DIGEST_CLAIM_TTL_MS).toISOString(),
  );
  assert.equal(reclaimCalls[0]?.claimedAt, now);
});

test("treats an active or already-sent claim as a duplicate", async () => {
  const { acquireActivityDigestClaim } = await deliveryModule;
  const uniqueError = new Prisma.PrismaClientKnownRequestError("duplicate", {
    code: "P2002",
    clientVersion: "test",
  });

  const claim = await acquireActivityDigestClaim(
    {
      organizationId: "org-a",
      recipientUserId: "user-a",
      periodStart: new Date("2026-07-27T00:00:00.000Z"),
      periodEnd: new Date("2026-08-03T00:00:00.000Z"),
    },
    new Date("2026-08-03T08:30:00.000Z"),
    {
      create: async () => {
        throw uniqueError;
      },
      reclaim: async () => null,
    },
  );

  assert.equal(claim, null);
});

test("uses an atomic stale-only reclaim and lease-owned completion writes", () => {
  const source = fs.readFileSync(
    path.join(process.cwd(), "src/lib/activity-digest-delivery.ts"),
    "utf8",
  );

  assert.match(
    source,
    /updateManyAndReturn\([\s\S]*sentAt: null,[\s\S]*claimedAt: \{ lt: staleBefore \}/,
  );
  assert.match(
    source,
    /releaseDigestSendClaim\([\s\S]*sentAt: ACTIVITY_DIGEST_SEND_PENDING_SENTINEL/,
  );
  assert.match(
    source,
    /markDigestSendPending\([\s\S]*sentAt: ACTIVITY_DIGEST_SEND_PENDING_SENTINEL/,
  );
  assert.match(
    source,
    /recordDigestSendCompleted\([\s\S]*sentAt: ACTIVITY_DIGEST_SEND_PENDING_SENTINEL/,
  );
  assert.match(
    source,
    /mapWithConcurrency\(\s*recipients,\s*ACTIVITY_DIGEST_SEND_CONCURRENCY,/,
  );
});

test("stale reclaim does not take over a pending-send sentinel claim", async () => {
  const {
    ACTIVITY_DIGEST_CLAIM_TTL_MS,
    ACTIVITY_DIGEST_SEND_PENDING_SENTINEL,
    acquireActivityDigestClaim,
  } = await deliveryModule;
  const now = new Date("2026-08-03T08:30:00.000Z");
  const uniqueError = new Prisma.PrismaClientKnownRequestError("duplicate", {
    code: "P2002",
    clientVersion: "test",
  });

  const claim = await acquireActivityDigestClaim(
    {
      organizationId: "org-a",
      recipientUserId: "user-a",
      periodStart: new Date("2026-07-27T00:00:00.000Z"),
      periodEnd: new Date("2026-08-03T00:00:00.000Z"),
    },
    now,
    {
      create: async () => {
        throw uniqueError;
      },
      reclaim: async ({ staleBefore, claimedAt }) => {
        assert.equal(
          staleBefore.toISOString(),
          new Date(now.getTime() - ACTIVITY_DIGEST_CLAIM_TTL_MS).toISOString(),
        );
        assert.equal(claimedAt, now);
        return null;
      },
    },
  );

  assert.equal(claim, null);
  assert.equal(
    ACTIVITY_DIGEST_SEND_PENDING_SENTINEL.toISOString(),
    "1970-01-01T00:00:00.000Z",
  );
});

test("runs digest sends with a fixed upper concurrency bound and stable results", async () => {
  const { ACTIVITY_DIGEST_SEND_CONCURRENCY, mapWithConcurrency } =
    await deliveryModule;
  let active = 0;
  let peak = 0;
  const release: Array<() => void> = [];
  const gates = Array.from(
    { length: 10 },
    () => new Promise<void>((resolve) => release.push(resolve)),
  );

  const pending = mapWithConcurrency(
    Array.from({ length: 10 }, (_, index) => index),
    ACTIVITY_DIGEST_SEND_CONCURRENCY,
    async (value) => {
      active += 1;
      peak = Math.max(peak, active);
      await gates[value];
      active -= 1;
      return value * 2;
    },
  );

  await new Promise<void>((resolve) => setImmediate(resolve));
  assert.equal(active, ACTIVITY_DIGEST_SEND_CONCURRENCY);
  assert.equal(peak, ACTIVITY_DIGEST_SEND_CONCURRENCY);

  for (const unblock of release) {
    unblock();
    await new Promise<void>((resolve) => setImmediate(resolve));
  }

  assert.deepEqual(await pending, [0, 2, 4, 6, 8, 10, 12, 14, 16, 18]);
  assert.ok(peak <= ACTIVITY_DIGEST_SEND_CONCURRENCY);
});
