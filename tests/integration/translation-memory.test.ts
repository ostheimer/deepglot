import assert from "node:assert/strict";
import { after, test } from "node:test";

import { resolveDatabaseUrl } from "@/lib/database-url";
import { computeTranslationHash } from "@/lib/translation-hash";
import { findOrganizationTranslationMemory } from "@/lib/translation-memory";

const databaseUrl = resolveDatabaseUrl();
const skipWithoutDatabase = databaseUrl
  ? false
  : "requires a prepared PostgreSQL database via DATABASE_URL or DEEPGLOT_DATABASE_URL";
const organizationIds: string[] = [];

test(
  "organization translation memory returns the newest sibling-approved value and never crosses tenants",
  { skip: skipWithoutDatabase },
  async () => {
    const { db } = await import("@/lib/db");
    const runId = crypto.randomUUID();
    const owner = await db.organization.create({
      data: { name: "Memory owner", slug: `memory-owner-${runId}` },
    });
    const foreign = await db.organization.create({
      data: { name: "Memory foreign", slug: `memory-foreign-${runId}` },
    });
    organizationIds.push(owner.id, foreign.id);

    const [target, sibling, draftSibling, foreignProject] = await Promise.all([
      db.project.create({
        data: {
          name: "Target",
          domain: `target-${runId}.example`,
          organizationId: owner.id,
        },
      }),
      db.project.create({
        data: {
          name: "Sibling",
          domain: `sibling-${runId}.example`,
          organizationId: owner.id,
        },
      }),
      db.project.create({
        data: {
          name: "Draft sibling",
          domain: `draft-sibling-${runId}.example`,
          organizationId: owner.id,
        },
      }),
      db.project.create({
        data: {
          name: "Foreign",
          domain: `foreign-${runId}.example`,
          organizationId: foreign.id,
        },
      }),
    ]);
    const originalText = "Gemeinsam geprüfter Text";
    const originalHash = computeTranslationHash(originalText, "de", "en");

    await db.translation.createMany({
      data: [
        {
          projectId: sibling.id,
          originalHash,
          originalText,
          translatedText: "Shared reviewed text",
          langFrom: "de",
          langTo: "en",
          source: "MANUAL",
          isManual: true,
          workflowStatus: "APPROVED",
          updatedAt: new Date("2026-07-13T12:00:00Z"),
        },
        {
          projectId: draftSibling.id,
          originalHash,
          originalText,
          translatedText: "Newer but not approved",
          langFrom: "de",
          langTo: "en",
          source: "MANUAL",
          isManual: true,
          workflowStatus: "IN_REVIEW",
          updatedAt: new Date("2026-07-13T14:00:00Z"),
        },
        {
          projectId: foreignProject.id,
          originalHash,
          originalText,
          translatedText: "Leaked foreign text",
          langFrom: "de",
          langTo: "en",
          source: "MANUAL",
          isManual: true,
          workflowStatus: "APPROVED",
          updatedAt: new Date("2026-07-13T13:00:00Z"),
        },
      ],
    });

    const hits = await findOrganizationTranslationMemory(db, {
      organizationId: owner.id,
      targetProjectId: target.id,
      originalHashes: [originalHash],
      langFrom: "de",
      langTo: "en",
    });

    assert.equal(hits.size, 1);
    assert.equal(hits.get(originalHash)?.translatedText, "Shared reviewed text");
  }
);

after(async () => {
  if (databaseUrl) {
    const { db } = await import("@/lib/db");
    if (organizationIds.length > 0) {
      await db.organization.deleteMany({ where: { id: { in: organizationIds } } });
    }
    await db.$disconnect();
  }
});
