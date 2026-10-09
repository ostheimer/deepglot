import assert from "node:assert/strict";
import test from "node:test";
import { conservativeInputUnits, quotedMicros, spendWithinCap, utcPeriodKey } from "@/lib/ai-budget-math";
import { aiBudgetPolicyInput } from "@/lib/ai-budget-policy";

test("UTC month boundary is independent of local timezone and has no rollover", () => {
  assert.equal(utcPeriodKey(new Date("2026-10-31T23:59:59Z")), 202610);
  assert.equal(utcPeriodKey(new Date("2026-11-01T00:00:00Z")), 202611);
});

test("provider quote rounds up at micro precision and rejects expired or unbounded units", () => {
  const price = { unit: "TOKEN" as const, inputMicrosPerMillion: BigInt(250_000),
    outputMicrosPerMillion: BigInt(1_000_000), maxInputUnits: 1000,
    maxOutputUnits: 100, priceExpiresAt: new Date("2026-11-01T00:00:00Z") };
  assert.equal(quotedMicros(price, 1, 1, new Date("2026-10-09T00:00:00Z")), BigInt(2));
  assert.throws(() => quotedMicros(price, 1001, 1, new Date("2026-10-09T00:00:00Z")), { code: "estimate_unbounded" });
  assert.throws(() => quotedMicros(price, 1, 1, new Date("2026-11-01T00:00:00Z")), { code: "price_stale" });
});

test("hard cap includes all held attempts and token estimate bounds Unicode bytes", () => {
  assert.equal(spendWithinCap(BigInt(999), BigInt(1), BigInt(1000)), true);
  assert.equal(spendWithinCap(BigInt(999), BigInt(2), BigInt(1000)), false);
  assert.ok(conservativeInputUnits({ texts: ["Übergröße"] }, "TOKEN") > 4096 + 10);
});

test("approval rejects invented currency codes and stale price snapshots", () => {
  const input = { scope: "organization", currency: "USD", capMicros: "1000000",
    perCallCapMicros: "100000", warningPercent: 80, period: "MONTHLY_UTC",
    models: [{ provider: "mock", model: "mock", unit: "ZERO_COST", inputMicrosPerMillion: "0",
      outputMicrosPerMillion: "0", maxInputUnits: 100, maxOutputUnits: 0,
      outputCapVerified: false, priceExpiresAt: new Date(Date.now() + 86400000).toISOString() }] };
  assert.equal(aiBudgetPolicyInput.safeParse(input).success, true);
  assert.equal(aiBudgetPolicyInput.safeParse({ ...input, currency: "XYZ" }).success, false);
  assert.equal(aiBudgetPolicyInput.safeParse({ ...input, models: [{ ...input.models[0],
    priceExpiresAt: new Date(Date.now() - 1000).toISOString() }] }).success, false);
});
