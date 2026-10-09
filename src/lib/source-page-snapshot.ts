import { createHash } from "node:crypto";

export const SOURCE_SNAPSHOT_FRESH_MS = 15 * 60_000;
export const SOURCE_SNAPSHOT_CAPTURE_SKEW_MS = 5 * 60_000;
export const SOURCE_SNAPSHOT_MAX_HASHES = 2_000;
export const SOURCE_SNAPSHOT_PROVENANCE = "wp-server-dom-v1";

export type SourcePresence = "present" | "absent_captured_pages" | "unknown";
export type SnapshotEvidence = {
  urlPath: string;
  langFrom: string;
  langTo: string;
  originalHashes: readonly string[];
  complete: boolean;
  dynamicPossible: boolean;
  provenance: string;
  capturedAt: Date;
  uncertainUntil: Date | null;
};

/** Absence is only within every explicitly recorded, fresh, complete source page. */
export function classifyTranslationSourcePresence(input: {
  originalHash: string;
  langFrom: string;
  langTo: string;
  contextPaths: readonly string[];
  snapshots: readonly SnapshotEvidence[];
  now: Date;
}): SourcePresence {
  if (!input.contextPaths.length) return "unknown";
  const byPath = new Map(input.snapshots.map((snapshot) => [snapshot.urlPath, snapshot]));
  let uncertain = false;
  let present = false;
  for (const path of input.contextPaths) {
    const snapshot = byPath.get(path);
    if (!snapshot || snapshot.langFrom !== input.langFrom || snapshot.langTo !== input.langTo ||
      snapshot.provenance !== SOURCE_SNAPSHOT_PROVENANCE || !snapshot.complete ||
      snapshot.dynamicPossible || snapshot.capturedAt.getTime() > input.now.getTime() ||
      input.now.getTime() - snapshot.capturedAt.getTime() > SOURCE_SNAPSHOT_FRESH_MS ||
      (snapshot.uncertainUntil && snapshot.uncertainUntil > input.now)) {
      uncertain = true;
      continue;
    }
    if (snapshot.originalHashes.includes(input.originalHash)) present = true;
  }
  if (present) return "present";
  return uncertain ? "unknown" : "absent_captured_pages";
}

export function snapshotDigest(input: {
  originalHashes: readonly string[];
  complete: boolean;
  dynamicPossible: boolean;
  provenance: string;
}) {
  return createHash("sha256").update(JSON.stringify({
    originalHashes: [...new Set(input.originalHashes)].sort(),
    complete: input.complete, dynamicPossible: input.dynamicPossible,
    provenance: input.provenance,
  })).digest("hex");
}

/** A delayed HTTP delivery cannot replace a newer captured source. */
export function decideSnapshotWrite(input: {
  now: Date;
  capturedMicros: bigint;
  digest: string;
  complete: boolean;
  previous?: { clientCapturedMicros: bigint; contentDigest: string;
    capturedAt: Date; uncertainUntil: Date | null } | null;
}) {
  const previous = input.previous;
  if (previous && input.capturedMicros <= previous.clientCapturedMicros)
    return { kind: "stale" as const };
  const conflict = previous && previous.contentDigest !== input.digest &&
    input.now.getTime() - previous.capturedAt.getTime() < SOURCE_SNAPSHOT_FRESH_MS;
  const uncertainUntil = conflict
    ? new Date(input.now.getTime() + SOURCE_SNAPSHOT_FRESH_MS)
    : previous?.uncertainUntil && previous.uncertainUntil > input.now
      ? previous.uncertainUntil : null;
  return { kind: "write" as const, complete: input.complete && !uncertainUntil,
    uncertainUntil };
}
