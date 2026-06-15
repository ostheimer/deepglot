import { describe, it } from "node:test";
import assert from "node:assert";

import {
  QUOTA_ALERT_THRESHOLDS,
  crossedQuotaThresholds,
} from "@/lib/quota-usage";
import { buildQuotaAlertEmailPayload } from "@/lib/email";

describe("QUOTA_ALERT_THRESHOLDS", () => {
  it("alerts at the 90% warning line and at 100%", () => {
    assert.deepEqual([...QUOTA_ALERT_THRESHOLDS], [90, 100]);
  });
});

describe("crossedQuotaThresholds", () => {
  const limit = 1_000_000;

  it("returns nothing when no threshold is crossed", () => {
    assert.deepEqual(crossedQuotaThresholds(0, 500_000, limit), []);
    assert.deepEqual(crossedQuotaThresholds(910_000, 950_000, limit), []);
  });

  it("flags 90 when an increment crosses the warning line", () => {
    assert.deepEqual(crossedQuotaThresholds(899_000, 901_000, limit), [90]);
    assert.deepEqual(crossedQuotaThresholds(0, 900_000, limit), [90]);
  });

  it("flags both when a single increment jumps past 90% and 100%", () => {
    assert.deepEqual(crossedQuotaThresholds(800_000, 1_000_000, limit), [90, 100]);
  });

  it("flags only 100 when starting already in the warning band", () => {
    assert.deepEqual(crossedQuotaThresholds(950_000, 1_000_000, limit), [100]);
  });

  it("does not re-flag a threshold already passed", () => {
    assert.deepEqual(crossedQuotaThresholds(900_000, 950_000, limit), []);
    assert.deepEqual(crossedQuotaThresholds(1_000_000, 1_200_000, limit), []);
  });

  it("is a no-op for non-positive limits or non-increasing usage", () => {
    assert.deepEqual(crossedQuotaThresholds(0, 100, 0), []);
    assert.deepEqual(crossedQuotaThresholds(500, 500, limit), []);
    assert.deepEqual(crossedQuotaThresholds(600, 500, limit), []);
  });

  it("scales with the effective limit (e.g. a raised cap)", () => {
    const raised = 5_000_000;
    assert.deepEqual(crossedQuotaThresholds(4_400_000, 4_600_000, raised), [90]);
    assert.deepEqual(crossedQuotaThresholds(4_600_000, 5_000_000, raised), [100]);
  });
});

describe("buildQuotaAlertEmailPayload", () => {
  const base = {
    to: "owner@example.test",
    from: "noreply@deepglot.ai",
    organizationName: "Acme GmbH",
    wordsUsed: 900_000,
    wordsLimit: 1_000_000,
    dashboardUrl: "https://deepglot.ai/abonnement/nutzung",
  };

  it("uses approaching wording below 100%", () => {
    const payload = buildQuotaAlertEmailPayload({ ...base, threshold: 90 });
    assert.match(payload.subject, /90% of your monthly word limit/);
    assert.match(payload.subject, /Acme GmbH/);
    assert.match(payload.text, /90%/);
    assert.match(payload.text, /Deine Deepglot-Organisation/); // bilingual
    assert.match(payload.html, /deepglot\.ai\/abonnement\/nutzung/);
    assert.equal(payload.to, base.to);
    assert.equal(payload.from, base.from);
  });

  it("uses reached wording at 100%", () => {
    const payload = buildQuotaAlertEmailPayload({
      ...base,
      threshold: 100,
      wordsUsed: 1_000_000,
    });
    assert.match(payload.subject, /monthly word limit reached/);
    assert.match(payload.text, /reached its monthly word limit/);
    assert.match(payload.text, /Wortlimit erreicht/);
  });

  it("escapes organization names in the HTML body", () => {
    const payload = buildQuotaAlertEmailPayload({
      ...base,
      organizationName: '<img src="x" onerror="alert(1)"> & "Acme"',
      threshold: 90,
    });

    assert.match(payload.text, /<img src="x" onerror="alert\(1\)"> & "Acme"/);
    assert.doesNotMatch(payload.html, /<img src="x" onerror="alert\(1\)">/);
    assert.match(
      payload.html,
      /&lt;img src=&quot;x&quot; onerror=&quot;alert\(1\)&quot;&gt; &amp; &quot;Acme&quot;/,
    );
  });
});
