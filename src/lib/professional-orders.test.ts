import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  assertOrderTransition, assertQuote, hashVendorToken, professionalOrdersEnabled,
  quoteIsCurrent, scopeDigest, vendorTokenMatches,
} from "./professional-orders";

describe("professional translation order boundaries", () => {
  it("binds a quote to the exact source snapshot, independently of selection order", () => {
    const a = { translationId: "a", originalHash: "h1", originalText: "Hello", sourceUpdatedAt: new Date("2026-01-01T00:00:00Z") };
    const b = { translationId: "b", originalHash: "h2", originalText: "World", sourceUpdatedAt: new Date("2026-01-01T00:00:00Z") };
    assert.equal(scopeDigest([a, b], "en", "de"), scopeDigest([b, a], "en", "de"));
    assert.notEqual(scopeDigest([a, b], "en", "de"), scopeDigest([{ ...a, originalText: "Changed" }, b], "en", "de"));
    assert.notEqual(scopeDigest([a, b], "en", "de"), scopeDigest([a, b], "en", "fr"));
  });

  it("rejects quote replay after expiry and invalid paid-state shortcuts", () => {
    const now = new Date("2026-01-10T12:00:00Z");
    assert.equal(quoteIsCurrent("QUOTED", new Date("2026-01-10T12:00:00Z"), now), false);
    assert.equal(quoteIsCurrent("QUOTED", new Date("2026-01-10T12:00:01Z"), now), true);
    assert.throws(() => assertOrderTransition("QUOTE_REQUESTED", "PAID"));
    assert.throws(() => assertOrderTransition("DELIVERED", "CANCELED"));
    assert.doesNotThrow(() => assertOrderTransition("DELIVERED", "REFUND_PENDING"));
    assert.throws(() => assertQuote(0, "EUR", 3, new Date("2026-01-11T12:00:00Z"), now));
    assert.throws(() => assertQuote(1200, "EUR", 3, new Date("2026-02-11T12:00:00Z"), now));
  });

  it("stores only a hash for scoped vendor grants", () => {
    const token = `dgpo_${"a".repeat(64)}`;
    const hash = hashVendorToken(token);
    assert.notEqual(hash, token);
    assert.equal(vendorTokenMatches(token, hash), true);
    assert.equal(vendorTokenMatches(`dgpo_${"b".repeat(64)}`, hash), false);
  });

  it("requires every launch acceptance flag", () => {
    const keys = ["PROFESSIONAL_ORDERS_ENABLED", "PROFESSIONAL_ORDERS_LEGAL_ACCEPTED", "PROFESSIONAL_ORDERS_PRIVACY_ACCEPTED", "PROFESSIONAL_ORDERS_BILLING_ACCEPTED", "PROFESSIONAL_ORDERS_PRODUCTION_ACCEPTED"];
    const old = Object.fromEntries(keys.map((key) => [key, process.env[key]]));
    try {
      for (const key of keys) process.env[key] = "true";
      assert.equal(professionalOrdersEnabled(), true);
      for (const key of keys) {
        delete process.env[key];
        assert.equal(professionalOrdersEnabled(), false);
        process.env[key] = "true";
      }
    } finally {
      for (const key of keys) {
        const value = old[key];
        if (value === undefined) delete process.env[key]; else process.env[key] = value;
      }
    }
  });
});
