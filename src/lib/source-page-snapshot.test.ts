import assert from "node:assert/strict";
import test from "node:test";
import { classifyTranslationSourcePresence, decideSnapshotWrite,
  SOURCE_SNAPSHOT_PROVENANCE } from "./source-page-snapshot";

const now = new Date("2026-10-09T12:00:00.000Z");
const base = { originalHash: "a".repeat(32), langFrom: "de", langTo: "en",
  contextPaths: ["/en/a", "/en/b"], now };
const complete = (urlPath: string, hashes: string[] = []) => ({ urlPath,
  langFrom: "de", langTo: "en", originalHashes: hashes, complete: true,
  dynamicPossible: false, provenance: SOURCE_SNAPSHOT_PROVENANCE,
  capturedAt: new Date(now.getTime() - 1_000), uncertainUntil: null });

test("all known fresh source-page contexts must prove absence", () => {
  assert.equal(classifyTranslationSourcePresence({ ...base,
    snapshots: [complete("/en/a"), complete("/en/b")] }), "absent_captured_pages");
  assert.equal(classifyTranslationSourcePresence({ ...base,
    snapshots: [complete("/en/a"), complete("/en/b", [base.originalHash])] }), "present");
  assert.equal(classifyTranslationSourcePresence({ ...base,
    snapshots: [complete("/en/a")] }), "unknown");
  assert.equal(classifyTranslationSourcePresence({ ...base, contextPaths: [],
    snapshots: [complete("/en/a")] }), "unknown");
});

test("stale, dynamic, incomplete and uncertain captures never prove absence", () => {
  const cases = [
    { capturedAt: new Date(now.getTime() - 16 * 60_000) },
    { complete: false }, { dynamicPossible: true },
    { provenance: "unknown-client" },
    { uncertainUntil: new Date(now.getTime() + 60_000) },
  ];
  for (const change of cases) assert.equal(classifyTranslationSourcePresence({ ...base,
    snapshots: [complete("/en/a"), { ...complete("/en/b"), ...change }] }), "unknown");
});

test("out-of-order captures cannot replace newer complete evidence", () => {
  const previous = { clientCapturedMicros: BigInt(100), contentDigest: "a",
    capturedAt: now, uncertainUntil: null };
  assert.deepEqual(decideSnapshotWrite({ now, capturedMicros: BigInt(99), digest: "b",
    complete: true, previous }), { kind: "stale" });
  const conflict = decideSnapshotWrite({ now, capturedMicros: BigInt(101), digest: "b",
    complete: true, previous });
  assert.equal(conflict.kind, "write");
  if (conflict.kind === "write") {
    assert.equal(conflict.complete, false);
    assert.ok(conflict.uncertainUntil && conflict.uncertainUntil > now);
  }
});
