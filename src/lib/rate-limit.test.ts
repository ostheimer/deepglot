import assert from "node:assert/strict";
import test from "node:test";

import {
  MemoryRateLimitStore,
  consumeRateLimit,
  getRateLimitConfig,
  hashRateLimitSubject,
} from "@/lib/rate-limit";

test("hashes rate-limit subjects without storing raw identifiers", () => {
  const hash = hashRateLimitSubject("translate", "dg_live_secret");

  assert.equal(hash.length, 64);
  assert.equal(hash, hashRateLimitSubject("translate", "dg_live_secret"));
  assert.notEqual(hash, hashRateLimitSubject("plugin", "dg_live_secret"));
  assert.ok(!hash.includes("dg_live_secret"));
});

test("uses documented per-minute rate-limit defaults with env overrides", () => {
  assert.deepEqual(getRateLimitConfig({}), {
    translatePerMinute: 60,
    pluginPerMinute: 120,
    authPerMinute: 5,
  });
  assert.deepEqual(
    getRateLimitConfig({
      TRANSLATE_RATE_LIMIT_PER_MINUTE: "10",
      PLUGIN_RATE_LIMIT_PER_MINUTE: "20",
      AUTH_RATE_LIMIT_PER_MINUTE: "2",
    }),
    {
      translatePerMinute: 10,
      pluginPerMinute: 20,
      authPerMinute: 2,
    }
  );
});

test("falls back to safe defaults for invalid rate-limit env values", () => {
  assert.deepEqual(
    getRateLimitConfig({
      TRANSLATE_RATE_LIMIT_PER_MINUTE: "0",
      PLUGIN_RATE_LIMIT_PER_MINUTE: "-1",
      AUTH_RATE_LIMIT_PER_MINUTE: "nope",
    }),
    {
      translatePerMinute: 60,
      pluginPerMinute: 120,
      authPerMinute: 5,
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
