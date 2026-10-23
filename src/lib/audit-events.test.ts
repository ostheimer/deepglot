import assert from "node:assert/strict";
import test from "node:test";
import { sanitizeAuditMetadata, type AuditMetadata } from "@/lib/audit-events";
import { parseAuditFilters } from "@/lib/audit-query";

test("audit metadata is bounded to safe labels, IDs and counts", () => {
  assert.deepEqual(sanitizeAuditMetadata({ count: 2, status: "APPROVED", affectedId: "c123" }),
    { count: 2, status: "APPROVED", affectedId: "c123" });
  const invalidMetadata: AuditMetadata[] = [
    { apiKey: "dg_live_secret" },
    { translatedText: "Hello" },
    { url: "https://webhook.example.test/secret" },
    { status: "text with spaces" },
    { count: -1 },
    { affectedId: "x".repeat(81) },
  ];
  for (const metadata of invalidMetadata) assert.throws(() => sanitizeAuditMetadata(metadata));
});

test("audit filters reject invalid dates, IDs and categories", () => {
  assert.deepEqual(parseAuditFilters(new URLSearchParams("from=2026-10-01&to=2026-10-09&category=project")), {
    from: new Date("2026-09-30T22:00:00.000Z"), toExclusive: new Date("2026-10-09T22:00:00.000Z"),
    category: "project", actorUserId: undefined, projectId: undefined,
  });
  assert.deepEqual(parseAuditFilters(new URLSearchParams("from=2026-10-25&to=2026-10-25")), {
    from: new Date("2026-10-24T22:00:00.000Z"), toExclusive: new Date("2026-10-25T23:00:00.000Z"),
    category: undefined, actorUserId: undefined, projectId: undefined,
  });
  for (const query of ["from=2026-02-30", "from=2026-10-10&to=2026-10-09",
    "category=secrets", "actor=x%2F..", "project=" + "x".repeat(81)]) {
    assert.throws(() => parseAuditFilters(new URLSearchParams(query)));
  }
});
