import assert from "node:assert/strict";
import { test } from "node:test";
import { resolveDatabaseUrl } from "@/lib/database-url";
import { recordTranslationTypes } from "@/lib/translation-type-observations";
import { listProjectTranslationWorkflow } from "@/lib/translation-workflow";
import type { ReportedTypeFilter } from "@/lib/translation-reported-types";

test(
  "reported types are additive, tenant/language scoped, paginated and cascade with content",
  {
    skip: !resolveDatabaseUrl() && "requires isolated PostgreSQL",
  },
  async () => {
    const { db } = await import("@/lib/db");
    const suffix = crypto.randomUUID();
    const org = await db.organization.create({
      data: { name: suffix, slug: suffix },
    });
    try {
      const project = await db.project.create({
        data: {
          name: suffix,
          domain: "types.test",
          originalLang: "de",
          organizationId: org.id,
          languages: { create: [{ langCode: "en" }, { langCode: "fr" }] },
        },
      });
      const foreign = await db.project.create({
        data: {
          name: "foreign",
          domain: "foreign.test",
          organizationId: org.id,
        },
      });
      const create = (hash: string, langTo = "en", projectId = project.id) =>
        db.translation.create({
          data: {
            projectId,
            langFrom: "de",
            langTo,
            originalHash: hash,
            originalText: hash,
            translatedText: hash,
            source: "MANUAL",
            isManual: true,
            workflowStatus: "APPROVED",
          },
        });
      const shared = await create("same");
      const unknown = await create("unknown.png");
      const alt = await create("alt");
      const other = await create("other");
      await create("french", "fr");
      await create("same", "en", foreign.id);
      const record = (hashes: string[], types: unknown[]) =>
        db.$transaction((tx) =>
          recordTranslationTypes(tx, {
            projectId: project.id,
            langFrom: "de",
            langTo: "en",
            hashes,
            words: types.map((t) => ({ t })),
          }),
        );
      await record(
        [
          "same",
          "same",
          "same",
          "alt",
          "other",
          "unknown.png",
          "missing",
          "french",
        ],
        [1, 6, 1, 7, 0, "6", 10, 6],
      );
      const first = await db.translationTypeObservation.findMany({
        where: { translationId: shared.id },
        orderBy: { wordType: "asc" },
      });
      assert.deepEqual(
        first.map((o) => o.wordType),
        [1, 6],
      );
      await Promise.all([record(["same"], [10]), record(["same"], [6])]);
      const second = await db.translationTypeObservation.findMany({
        where: { translationId: shared.id },
        orderBy: { wordType: "asc" },
      });
      assert.deepEqual(
        second.map((o) => o.wordType),
        [1, 6, 10],
      );
      assert.equal(
        second[1].firstSeenAt.toISOString(),
        first[1].firstSeenAt.toISOString(),
      );
      assert.ok(second[1].lastSeenAt >= first[1].lastSeenAt);
      const content = await db.translation.findUniqueOrThrow({
        where: { id: shared.id },
      });
      assert.equal(
        content.updatedAt.toISOString(),
        shared.updatedAt.toISOString(),
      );
      assert.equal(content.workflowStatus, "APPROVED");
      assert.equal(
        await db.translationTypeObservation.count({
          where: { translation: { projectId: foreign.id } },
        }),
        0,
      );
      assert.equal(
        await db.translationTypeObservation.count({
          where: { translation: { projectId: project.id, langTo: "fr" } },
        }),
        0,
      );
      const actor = {
        canManage: false,
        projectMemberId: "translator",
        langCode: "en",
      };
      const expected: Record<ReportedTypeFilter, string[]> = {
        text: [alt.id, shared.id],
        media: [shared.id],
        link: [shared.id],
        other: [other.id],
        unknown: [unknown.id],
      };
      for (const [reportedType, ids] of Object.entries(expected)) {
        const result = await listProjectTranslationWorkflow({
          projectId: project.id,
          actor,
          filters: {
            reportedType: reportedType as ReportedTypeFilter,
            pageSize: 1,
            sort: "original_asc",
            source: "MANUAL",
            mode: "manual",
            status: "APPROVED",
            context: "unknown",
          },
        });
        assert.equal(result.total, ids.length, reportedType);
        assert.deepEqual(
          result.items.map((o) => o.id),
          ids.slice(0, 1),
        );
        if (ids.length > 1) {
          const page2 = await listProjectTranslationWorkflow({
            projectId: project.id,
            actor,
            filters: {
              reportedType: "text",
              pageSize: 1,
              page: 2,
              sort: "original_asc",
            },
          });
          assert.equal(page2.items[0].id, shared.id);
        }
      }
      await assert.rejects(
        listProjectTranslationWorkflow({
          projectId: project.id,
          actor,
          filters: { reportedType: "media", langTo: "fr" },
        }),
      );
      await db.translation.delete({ where: { id: shared.id } });
      assert.equal(
        await db.translationTypeObservation.count({
          where: { translationId: shared.id },
        }),
        0,
      );
    } finally {
      await db.organization.delete({ where: { id: org.id } });
      await db.$disconnect();
    }
  },
);
