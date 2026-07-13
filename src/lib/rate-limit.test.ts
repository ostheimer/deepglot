import assert from "node:assert/strict";
import test from "node:test";

import {
  MemoryRateLimitStore,
  TRANSLATE_WORD_VELOCITY_WINDOW_MS,
  consumeRateLimit,
  consumeTranslateWordVelocity,
  getRateLimitConfig,
  getTranslateWordVelocityLimit,
  hashRateLimitSubject,
  releaseTranslateWordVelocity,
} from "@/lib/rate-limit";

test("hashes rate-limit subjects without storing raw identifiers", () => {
  const hash = hashRateLimitSubject("translate", "dg_live_secret");

  assert.equal(hash.length, 64);
  assert.equal(hash, hashRateLimitSubject("translate", "dg_live_secret"));
  assert.notEqual(hash, hashRateLimitSubject("plugin", "dg_live_secret"));
  assert.ok(!hash.includes("dg_live_secret"));
});

test("derives the hourly fresh-word cap from ten percent of the monthly plan quota", () => {
  assert.equal(getTranslateWordVelocityLimit(10_000, {}), 1_000);
  assert.equal(getTranslateWordVelocityLimit(25_000, {}), 2_500);
  assert.equal(getTranslateWordVelocityLimit(200_000, {}), 20_000);
  assert.equal(getTranslateWordVelocityLimit(20_000_000, {}), 2_000_000);
});

test("lets an explicit velocity-limit environment override win over the plan-derived cap", () => {
  assert.equal(
    getTranslateWordVelocityLimit(20_000_000, {
      TRANSLATE_WORD_VELOCITY_PER_HOUR: "75000",
    }),
    75_000
  );
  assert.equal(
    getTranslateWordVelocityLimit(200_000, {
      TRANSLATE_WORD_VELOCITY_PER_HOUR: "invalid",
    }),
    20_000
  );
});

test("uses documented per-minute rate-limit defaults with env overrides", () => {
  assert.deepEqual(getRateLimitConfig({}), {
    translatePerMinute: 60,
    pluginPerMinute: 120,
    authPerMinute: 5,
    translateWordVelocityPerHour: 50_000,
  });
  assert.deepEqual(
    getRateLimitConfig({
      TRANSLATE_RATE_LIMIT_PER_MINUTE: "10",
      PLUGIN_RATE_LIMIT_PER_MINUTE: "20",
      AUTH_RATE_LIMIT_PER_MINUTE: "2",
      TRANSLATE_WORD_VELOCITY_PER_HOUR: "12345",
    }),
    {
      translatePerMinute: 10,
      pluginPerMinute: 20,
      authPerMinute: 2,
      translateWordVelocityPerHour: 12_345,
    }
  );
});

test("falls back to safe defaults for invalid rate-limit env values", () => {
  assert.deepEqual(
    getRateLimitConfig({
      TRANSLATE_RATE_LIMIT_PER_MINUTE: "0",
      PLUGIN_RATE_LIMIT_PER_MINUTE: "-1",
      AUTH_RATE_LIMIT_PER_MINUTE: "nope",
      TRANSLATE_WORD_VELOCITY_PER_HOUR: "-5",
    }),
    {
      translatePerMinute: 60,
      pluginPerMinute: 120,
      authPerMinute: 5,
      translateWordVelocityPerHour: 50_000,
    }
  );
});

test("limits requests within a fixed window and returns retry timing", async () => {
  const store = new MemoryRateLimitStore();
  const now = new Date("2026-04-30T10:00:00.000Z");

  const first = await consumeRateLimit({
    scope: "translate",
    subject: "api-key-id",
    limit: 2,
    windowMs: 60_000,
    now,
    store,
  });
  const second = await consumeRateLimit({
    scope: "translate",
    subject: "api-key-id",
    limit: 2,
    windowMs: 60_000,
    now,
    store,
  });
  const third = await consumeRateLimit({
    scope: "translate",
    subject: "api-key-id",
    limit: 2,
    windowMs: 60_000,
    now,
    store,
  });

  assert.equal(first.allowed, true);
  assert.equal(second.allowed, true);
  assert.equal(third.allowed, false);
  assert.equal(third.limit, 2);
  assert.equal(third.remaining, 0);
  assert.equal(third.retryAfterSeconds, 60);
  assert.equal(third.resetAt.toISOString(), "2026-04-30T10:01:00.000Z");
});

test("resets expired rate-limit windows", async () => {
  const store = new MemoryRateLimitStore();

  await consumeRateLimit({
    scope: "auth:password-reset",
    subject: "office@example.test",
    limit: 1,
    windowMs: 60_000,
    now: new Date("2026-04-30T10:00:00.000Z"),
    store,
  });

  const reset = await consumeRateLimit({
    scope: "auth:password-reset",
    subject: "office@example.test",
    limit: 1,
    windowMs: 60_000,
    now: new Date("2026-04-30T10:01:01.000Z"),
    store,
  });

  assert.equal(reset.allowed, true);
  assert.equal(reset.remaining, 0);
  assert.equal(reset.resetAt.toISOString(), "2026-04-30T10:02:01.000Z");
});

test("consumes a per-request cost so a window budget is spent in units, not calls", async () => {
  const store = new MemoryRateLimitStore();
  const base = {
    scope: "translate:word-velocity",
    subject: "project_123",
    limit: 1000,
    windowMs: 3_600_000,
    store,
  };

  const first = await consumeRateLimit({ ...base, cost: 600, now: new Date("2026-04-30T10:00:00.000Z") });
  assert.equal(first.allowed, true);
  assert.equal(first.remaining, 400);

  // 600 + 500 = 1100 > 1000 → rejected, and the window stays spent (conservative).
  const second = await consumeRateLimit({ ...base, cost: 500, now: new Date("2026-04-30T10:05:00.000Z") });
  assert.equal(second.allowed, false);
  assert.equal(second.remaining, 0);
  assert.ok(second.retryAfterSeconds > 0);

  // A tiny follow-up is also blocked while the window is over budget.
  const third = await consumeRateLimit({ ...base, cost: 1, now: new Date("2026-04-30T10:10:00.000Z") });
  assert.equal(third.allowed, false);

  // Next window resets the budget.
  const fourth = await consumeRateLimit({ ...base, cost: 900, now: new Date("2026-04-30T11:30:00.000Z") });
  assert.equal(fourth.allowed, true);
  assert.equal(fourth.remaining, 100);
});

test("treats a cost below one as one unit", async () => {
  const store = new MemoryRateLimitStore();
  const result = await consumeRateLimit({
    scope: "translate:word-velocity",
    subject: "project_zero",
    limit: 5,
    cost: 0,
    windowMs: 3_600_000,
    store,
  });
  assert.equal(result.allowed, true);
  assert.equal(result.remaining, 4);
});

test("consumeTranslateWordVelocity reserves words per organization over an hour window", async () => {
  const store = new MemoryRateLimitStore();
  const now = new Date("2026-04-30T10:00:00.000Z");

  const ok = await consumeTranslateWordVelocity({ organizationId: "org1", words: 40_000, limit: 50_000, now, store });
  assert.equal(ok.allowed, true);
  assert.equal(ok.limit, 50_000);
  assert.equal(ok.remaining, 10_000);
  assert.equal(ok.resetAt.getTime(), now.getTime() + TRANSLATE_WORD_VELOCITY_WINDOW_MS);

  // A distinct organization has its own budget.
  const otherOrg = await consumeTranslateWordVelocity({ organizationId: "org2", words: 40_000, limit: 50_000, now, store });
  assert.equal(otherOrg.allowed, true);

  // The org cannot exceed its hourly budget — keyed per ORG, so spreading the
  // same spend across multiple projects/keys of the org cannot multiply it.
  const blocked = await consumeTranslateWordVelocity({
    organizationId: "org1",
    words: 20_000,
    limit: 50_000,
    now: new Date("2026-04-30T10:30:00.000Z"),
    store,
  });
  assert.equal(blocked.allowed, false);
});

test("consumeTranslateWordVelocity rejects without spending the rejected words", async () => {
  const store = new MemoryRateLimitStore();
  const base = {
    organizationId: "org_no_poison",
    limit: 1_000,
    store,
  };

  const first = await consumeTranslateWordVelocity({
    ...base,
    words: 600,
    now: new Date("2026-04-30T10:00:00.000Z"),
  });
  assert.equal(first.allowed, true);
  assert.equal(first.remaining, 400);

  const rejected = await consumeTranslateWordVelocity({
    ...base,
    words: 500,
    now: new Date("2026-04-30T10:05:00.000Z"),
  });
  assert.equal(rejected.allowed, false);
  assert.equal(rejected.remaining, 400);

  const stillFits = await consumeTranslateWordVelocity({
    ...base,
    words: 400,
    now: new Date("2026-04-30T10:10:00.000Z"),
  });
  assert.equal(stillFits.allowed, true);
  assert.equal(stillFits.remaining, 0);
});

test("consumeTranslateWordVelocity allows one oversized request in a fresh window", async () => {
  const store = new MemoryRateLimitStore();
  const base = {
    organizationId: "org_oversized_first",
    limit: 1_000,
    store,
  };

  const oversized = await consumeTranslateWordVelocity({
    ...base,
    words: 1_200,
    now: new Date("2026-04-30T10:00:00.000Z"),
  });
  assert.equal(oversized.allowed, true);
  assert.equal(oversized.remaining, 0);

  const blockedUntilReset = await consumeTranslateWordVelocity({
    ...base,
    words: 1,
    now: new Date("2026-04-30T10:01:00.000Z"),
  });
  assert.equal(blockedUntilReset.allowed, false);

  const nextWindow = await consumeTranslateWordVelocity({
    ...base,
    words: 1_200,
    now: new Date("2026-04-30T11:01:00.000Z"),
  });
  assert.equal(nextWindow.allowed, true);
  assert.equal(nextWindow.remaining, 0);
});

test("releaseTranslateWordVelocity refunds a successful reservation", async () => {
  const store = new MemoryRateLimitStore();
  const reservation = await consumeTranslateWordVelocity({
    organizationId: "org_refund",
    words: 700,
    limit: 1_000,
    now: new Date("2026-04-30T10:00:00.000Z"),
    store,
  });
  assert.equal(reservation.allowed, true);
  assert.equal(reservation.remaining, 300);

  await releaseTranslateWordVelocity({
    organizationId: "org_refund",
    words: 700,
    now: new Date("2026-04-30T10:01:00.000Z"),
    store,
  });

  const afterRefund = await consumeTranslateWordVelocity({
    organizationId: "org_refund",
    words: 1_000,
    limit: 1_000,
    now: new Date("2026-04-30T10:02:00.000Z"),
    store,
  });
  assert.equal(afterRefund.allowed, true);
  assert.equal(afterRefund.remaining, 0);
});
