import assert from "node:assert/strict";
import test from "node:test";

import {
  findOrganizationTranslationMemory,
  planSupportsTranslationMemory,
  type TranslationMemoryStore,
} from "./translation-memory";

test("translation memory is gated to canonical Pro and higher plans", () => {
  for (const plan of ["FREE", "STARTER", "BUSINESS", undefined, "unknown"]) {
    assert.equal(planSupportsTranslationMemory(plan), false, String(plan));
  }
  for (const plan of ["PRO", "PROFESSIONAL", "ADVANCED", "EXTENDED", "ENTERPRISE"]) {
    assert.equal(planSupportsTranslationMemory(plan), true, plan);
  }
});

test("returns the newest approved translation per hash across sibling projects", async () => {
  let receivedWhere: unknown;
  const store: TranslationMemoryStore = {
    translation: {
      findMany: async (args) => {
        receivedWhere = args.where;
        return [
          {
            originalHash: "hash-a",
            translatedText: "Newest A",
            updatedAt: new Date("2026-07-13T12:00:00Z"),
          },
          {
            originalHash: "hash-a",
            translatedText: "Older A",
            updatedAt: new Date("2026-07-12T12:00:00Z"),
          },
          {
            originalHash: "hash-b",
            translatedText: "Only B",
            updatedAt: new Date("2026-07-11T12:00:00Z"),
          },
        ];
      },
    },
  };

  const result = await findOrganizationTranslationMemory(store, {
    organizationId: "org-1",
    targetProjectId: "project-2",
    originalHashes: ["hash-a", "hash-b"],
    langFrom: "de",
    langTo: "en",
  });

  assert.deepEqual(receivedWhere, {
    project: { organizationId: "org-1" },
    projectId: { not: "project-2" },
    originalHash: { in: ["hash-a", "hash-b"] },
    langFrom: "de",
    langTo: "en",
    workflowStatus: "APPROVED",
  });
  assert.deepEqual(
    [...result.entries()].map(([hash, hit]) => [hash, hit.translatedText]),
    [
      ["hash-a", "Newest A"],
      ["hash-b", "Only B"],
    ]
  );
});

test("does not query the database when no hashes are pending", async () => {
  const store: TranslationMemoryStore = {
    translation: {
      findMany: async () => {
        throw new Error("must not query");
      },
    },
  };

  const result = await findOrganizationTranslationMemory(store, {
    organizationId: "org-1",
    targetProjectId: "project-2",
    originalHashes: [],
    langFrom: "de",
    langTo: "en",
  });

  assert.equal(result.size, 0);
});
