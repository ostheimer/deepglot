import assert from "node:assert/strict";
import test from "node:test";
import { Prisma } from "@prisma/client";

import { allowedNotificationFrequencies, mayReceiveOptionalNotification, notificationPeriodStart } from "@/lib/notification-preferences";

process.env.DATABASE_URL ??= "postgresql://unit-test:unit-test@127.0.0.1:5432/deepglot";

test("optional categories are off by default and mandatory notices are not a category", () => {
  assert.deepEqual(allowedNotificationFrequencies("PRODUCT_UPDATE"), ["OFF", "MONTHLY"]);
  assert.deepEqual(allowedNotificationFrequencies("PROJECT_ACTIVITY"), ["OFF", "WEEKLY"]);
  assert.equal(mayReceiveOptionalNotification({ category: "PRODUCT_UPDATE", frequency: "OFF", role: "OWNER" }), false);
  assert.equal(mayReceiveOptionalNotification({ category: "BILLING_SUMMARY", frequency: "MONTHLY", role: "MEMBER" }), false);
  assert.equal(mayReceiveOptionalNotification({ category: "BILLING_SUMMARY", frequency: "MONTHLY", role: "ADMIN" }), true);
  assert.equal(mayReceiveOptionalNotification({ category: "PROJECT_ACTIVITY", frequency: "WEEKLY", role: "MEMBER" }), false);
  assert.equal(mayReceiveOptionalNotification({ category: "PROJECT_ACTIVITY", frequency: "WEEKLY", role: "MEMBER", hasProjectAccess: true }), true);
  assert.equal(mayReceiveOptionalNotification({ category: "PRODUCT_UPDATE", frequency: "MONTHLY", role: null }), false);
});

test("missed weekly and monthly runs retain the original UTC period", () => {
  assert.equal(notificationPeriodStart("WEEKLY", new Date("2026-10-09T15:00:00Z")).toISOString(), "2026-10-05T00:00:00.000Z");
  assert.equal(notificationPeriodStart("MONTHLY", new Date("2026-10-09T15:00:00Z")).toISOString(), "2026-10-01T00:00:00.000Z");
});

test("concurrent duplicate claim only reclaims an expired unsent lease", async () => {
  const { acquireNotificationClaim, NOTIFICATION_CLAIM_TTL_MS } = await import("@/lib/notification-delivery");
  const now = new Date("2026-10-09T09:00:00Z");
  const key = { userId: "u", organizationId: "o", category: "PRODUCT_UPDATE" as const, periodStart: new Date("2026-10-01T00:00:00Z") };
  const duplicate = new Prisma.PrismaClientKnownRequestError("duplicate", { code: "P2002", clientVersion: "test" });
  let expires: Date | undefined;
  const result = await acquireNotificationClaim(key, now, {
    create: async () => { throw duplicate; },
    reclaim: async (_key, _now, staleBefore) => { expires = staleBefore; return null; },
  });
  assert.equal(result, null);
  assert.equal(expires?.getTime(), now.getTime() - NOTIFICATION_CLAIM_TTL_MS);
  const reclaimed = await acquireNotificationClaim(key, now, {
    create: async () => { throw duplicate; },
    reclaim: async () => ({ id: "retry", claimedAt: now }),
  });
  assert.deepEqual(reclaimed, { id: "retry", claimedAt: now });
});
