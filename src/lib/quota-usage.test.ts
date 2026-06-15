import { describe, it } from "node:test";
import assert from "node:assert";

import { QUOTA_WARNING_RATIO, quotaUsageLevel } from "@/lib/quota-usage";

describe("quotaUsageLevel", () => {
  const limit = 1_000_000;

  it("is ok well below the warning threshold", () => {
    assert.equal(quotaUsageLevel(0, limit), "ok");
    assert.equal(quotaUsageLevel(500_000, limit), "ok");
    assert.equal(quotaUsageLevel(899_999, limit), "ok");
  });

  it("warns from the warning ratio up to the limit", () => {
    assert.equal(quotaUsageLevel(QUOTA_WARNING_RATIO * limit, limit), "warning");
    assert.equal(quotaUsageLevel(950_000, limit), "warning");
    assert.equal(quotaUsageLevel(999_999, limit), "warning");
  });

  it("reports reached at and above the limit", () => {
    assert.equal(quotaUsageLevel(limit, limit), "reached");
    assert.equal(quotaUsageLevel(limit + 1, limit), "reached");
    assert.equal(quotaUsageLevel(5_000_000, limit), "reached");
  });

  it("treats a non-positive limit as ok (nothing to warn about)", () => {
    assert.equal(quotaUsageLevel(0, 0), "ok");
    assert.equal(quotaUsageLevel(100, 0), "ok");
    assert.equal(quotaUsageLevel(100, -10), "ok");
  });

  it("scales the thresholds with the effective limit (e.g. a raised cap)", () => {
    const raised = 5_000_000;
    assert.equal(quotaUsageLevel(4_000_000, raised), "ok");
    assert.equal(quotaUsageLevel(4_500_000, raised), "warning");
    assert.equal(quotaUsageLevel(5_000_000, raised), "reached");
  });
});
