import assert from "node:assert/strict";
import test from "node:test";

import type { Prisma } from "@prisma/client";

import {
  MAX_RUNTIME_MEDIA_REPLACEMENTS_BYTES,
  MediaRuntimePayloadLimitError,
  assertMediaRuntimeMutationWithinLimit,
  inspectMediaRuntimePayload,
  withBoundedMediaRuntimeMutation,
} from "@/lib/media-runtime-limits";
import {
  MediaReplacementError,
  buildRuntimeMediaReplacements,
} from "@/lib/media-replacements";

function longImageRows(count: number) {
  return Array.from({ length: count }, (_, index) => ({
    langTo: "en",
    originalUrl: `/uploads/${index}-${"a".repeat(990)}.png`,
    localizedUrl: `/uploads/${index}-${"b".repeat(990)}.webp`,
  }));
}

function shortImageRows(count: number) {
  return Array.from({ length: count }, (_, index) => ({
    langTo: "en",
    originalUrl: `/uploads/${index}.png`,
    localizedUrl: `/uploads/${index}.webp`,
  }));
}

test("runtime admission uses the exact compact WordPress mapping JSON and one shared 224 KiB ceiling", () => {
  const safeRows = longImageRows(113);
  const inspection = inspectMediaRuntimePayload(safeRows);

  assert.equal(MAX_RUNTIME_MEDIA_REPLACEMENTS_BYTES, 229_376);
  assert.deepEqual(inspection.mediaReplacements, buildRuntimeMediaReplacements(safeRows));
  assert.equal(
    inspection.byteLength,
    new TextEncoder().encode(
      JSON.stringify(buildRuntimeMediaReplacements(safeRows))
    ).byteLength
  );
  assert.ok(inspection.byteLength < MAX_RUNTIME_MEDIA_REPLACEMENTS_BYTES);
  assert.doesNotThrow(() => assertMediaRuntimeMutationWithinLimit([], safeRows));
});

test("a newly created or expanded mapping cannot make existing plugin runtime configuration unavailable", () => {
  const safeRows = longImageRows(113);
  const oversizedRows = longImageRows(114);

  assert.ok(
    inspectMediaRuntimePayload(oversizedRows).byteLength >
      MAX_RUNTIME_MEDIA_REPLACEMENTS_BYTES
  );
  assert.throws(
    () => assertMediaRuntimeMutationWithinLimit(safeRows, oversizedRows),
    (error: unknown) =>
      error instanceof MediaRuntimePayloadLimitError &&
      error.limit === MAX_RUNTIME_MEDIA_REPLACEMENTS_BYTES
  );

  const expandedRows = safeRows.map((row, index) =>
    index < 2
      ? {
          ...row,
          localizedUrl: `/uploads/${index}-${"c".repeat(2020)}.webp`,
        }
      : row
  );
  assert.throws(
    () => assertMediaRuntimeMutationWithinLimit(safeRows, expandedRows),
    MediaRuntimePayloadLimitError
  );
});

test("legacy oversized projects may progressively shrink but cannot grow or preserve their unsafe payload", () => {
  const previousRows = longImageRows(115);
  const smallerRows = longImageRows(114);
  const largerRows = longImageRows(116);

  assert.ok(
    inspectMediaRuntimePayload(previousRows).byteLength >
      MAX_RUNTIME_MEDIA_REPLACEMENTS_BYTES
  );
  assert.ok(
    inspectMediaRuntimePayload(smallerRows).byteLength >
      MAX_RUNTIME_MEDIA_REPLACEMENTS_BYTES
  );
  assert.doesNotThrow(() =>
    assertMediaRuntimeMutationWithinLimit(previousRows, smallerRows)
  );
  assert.throws(() =>
    assertMediaRuntimeMutationWithinLimit(previousRows, previousRows)
  );
  assert.throws(() =>
    assertMediaRuntimeMutationWithinLimit(previousRows, largerRows)
  );
});

test("language reactivation reevaluates active languages after mutation and rejects previously dormant image mappings", async () => {
  const englishRows = longImageRows(113);
  const dormantFrenchRow = {
    ...longImageRows(1)[0],
    langTo: "fr",
    originalUrl: `/uploads/dormant-${"a".repeat(990)}.png`,
  };
  const allRows = [...englishRows, dormantFrenchRow];
  let activeLanguages = ["EN"];
  let languageSnapshotReads = 0;

  const transaction = {
    projectLanguage: {
      findMany: async () => {
        languageSnapshotReads += 1;
        return activeLanguages.map((langCode) => ({ langCode }));
      },
    },
    projectMediaReplacement: {
      findMany: async (query: {
        where: { langTo: { in: string[] } };
      }) =>
        allRows.filter(({ langTo }) => query.where.langTo.in.includes(langTo)),
    },
  } as unknown as Prisma.TransactionClient;

  await assert.rejects(
    withBoundedMediaRuntimeMutation(transaction, "project-under-test", async () => {
      activeLanguages = ["EN", "FR"];
      return { count: 1 };
    }),
    MediaRuntimePayloadLimitError
  );
  assert.equal(languageSnapshotReads, 2);
});

test("legacy 501-row sentinels can recover below both limits but never remain oversized", () => {
  const legacySentinelRows = shortImageRows(501);
  const recoveredRows = shortImageRows(500);

  assert.doesNotThrow(() =>
    assertMediaRuntimeMutationWithinLimit(legacySentinelRows, recoveredRows)
  );
  assert.throws(
    () => assertMediaRuntimeMutationWithinLimit(legacySentinelRows, longImageRows(114)),
    MediaRuntimePayloadLimitError
  );

  for (const previousRows of [recoveredRows, legacySentinelRows]) {
    assert.throws(
      () => assertMediaRuntimeMutationWithinLimit(previousRows, legacySentinelRows),
      (error: unknown) =>
        error instanceof MediaReplacementError &&
        error.code === "MEDIA_REPLACEMENTS_LIMIT_EXCEEDED"
    );
  }
});
