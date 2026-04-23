import assert from "node:assert/strict";
import test from "node:test";

import {
  buildWebhookHeaders,
  getWebhookNextAttemptAt,
  signWebhookPayload,
} from "@/lib/webhooks";

test("signs webhook payloads deterministically", () => {
  const payload = JSON.stringify({ ok: true });
  const signature = signWebhookPayload(payload, "1710000000", "secret");

  assert.equal(signature.length, 64);
  assert.equal(
    signature,
    signWebhookPayload(payload, "1710000000", "secret")
  );
});

test("builds webhook headers with timestamp and signature", () => {
  const headers = buildWebhookHeaders(
    "translation.created",
    JSON.stringify({ id: 1 }),
    "secret",
    new Date("2025-01-01T00:00:00.000Z")
  );

  assert.equal(headers["X-Deepglot-Event"], "translation.created");
  assert.equal(headers["X-Deepglot-Timestamp"], "1735689600");
  assert.equal(headers["X-Deepglot-Signature"].length, 64);
});

test("uses exponential-style webhook retry delays", () => {
  const base = new Date("2025-01-01T00:00:00.000Z");

  assert.equal(
    getWebhookNextAttemptAt(0, base)?.toISOString(),
    "2025-01-01T00:01:00.000Z"
  );
  assert.equal(
    getWebhookNextAttemptAt(1, base)?.toISOString(),
    "2025-01-01T00:05:00.000Z"
  );
  assert.equal(
    getWebhookNextAttemptAt(2, base)?.toISOString(),
    "2025-01-01T00:15:00.000Z"
  );
  assert.equal(getWebhookNextAttemptAt(3, base), null);
});
