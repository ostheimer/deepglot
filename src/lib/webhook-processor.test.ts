import assert from "node:assert/strict";
import test from "node:test";

import {
  buildWebhookProcessorSummary,
  normalizeWebhookDeliveryStatus,
} from "@/lib/webhook-processor";

test("summarizes webhook processor dispatch results", () => {
  assert.deepEqual(
    buildWebhookProcessorSummary({
      results: [true, false, null, true],
      pendingRemaining: 3,
      durationMs: 157,
    }),
    {
      status: "SUCCESS",
      processed: 4,
      delivered: 2,
      failed: 1,
      skipped: 1,
      pendingRemaining: 3,
      durationMs: 157,
    }
  );
});

test("marks processor summary as failed when a route-level error occurs", () => {
  const summary = buildWebhookProcessorSummary({
    results: [],
    pendingRemaining: 0,
    durationMs: 25,
    errorMessage: "database unavailable",
  });

  assert.equal(summary.status, "FAILED");
  assert.equal(summary.errorMessage, "database unavailable");
});

test("normalizes webhook delivery status filters", () => {
  assert.equal(normalizeWebhookDeliveryStatus("FAILED"), "FAILED");
  assert.equal(normalizeWebhookDeliveryStatus("pending"), "PENDING");
  assert.equal(normalizeWebhookDeliveryStatus("unknown"), null);
  assert.equal(normalizeWebhookDeliveryStatus(null), null);
});
