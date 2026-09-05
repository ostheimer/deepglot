import assert from "node:assert/strict";
import { test } from "node:test";
import { Prisma, type Translation } from "@prisma/client";
import { resolveDatabaseUrl } from "@/lib/database-url";
import { listProjectTranslationWorkflow } from "@/lib/translation-workflow";
import {
  savedVariableQuality,
  observationCutoff,
} from "@/lib/translation-quality";
import { workspaceSqlWhere } from "@/lib/translation-workspace-query";

test(
  "quality and activity filters are exact, scoped and applied before pagination",
  {
    skip: !resolveDatabaseUrl() && "requires isolated PostgreSQL",
  },
  async () => {
    const { db } = await import("@/lib/db");
    const org = await db.organization.create({
      data: { name: "Quality", slug: crypto.randomUUID() },
    });
    try {
      const project = await db.project.create({
        data: {
          name: "Quality",
          domain: "quality.test",
          originalLang: "de",
          organizationId: org.id,
          languages: { create: [{ langCode: "en" }, { langCode: "fr" }] },
        },
      });
      const foreign = await db.project.create({
        data: {
          name: "Foreign",
          domain: "foreign.test",
          originalLang: "de",
          organizationId: org.id,
        },
      });
      const actor = { canManage: false, projectMemberId: null, langCode: "en" };
      const cases: Array<[string, string, string[]]> = [
        ["{name}", "Hello", ["{name}"]],
        ["%s %s", "%s", ["%s"]],
        ["%s", "%s %s", ["%s"]],
        ["%s", "%%s", ["%s"]],
        ["{name}", "{{name}}", ["{name}"]],
        ["{name}", "${name}", ["{name}"]],
        ["{{ name }}", "{{name}}", ["{{ name }}"]],
        ["{name}", "{Name}", ["{name}"]],
        ["{removed}", "{name}", ["{name}"]],
        ["%1$s %2$d", "%2$d %1$s", ["%1$s", "%2$d"]],
        ["Hallo {{name}}", "Hello {{name}}", ["{{name}}"]],
        [
          "Hallo {{\u00a0name\u00a0}}",
          "Hello {{\u00a0name\u00a0}}",
          ["{{\u00a0name\u00a0}}"],
        ],
        ["Unselected {name}", "No token", []],
        ["Literal %_\\' search", "Literal", []],
      ];
      const rows: Translation[] = [];
      for (const [originalText, translatedText, variables] of cases) {
        rows.push(
          await db.translation.create({
            data: {
              projectId: project.id,
              originalHash: crypto.randomUUID(),
              originalText,
              translatedText,
              langFrom: "de",
              langTo: "en",
              source: "MOCK",
              metadata: { create: { labels: ["qa"], variables } },
            },
          }),
        );
      }
      const noMetadata = await db.translation.create({
        data: {
          projectId: project.id,
          originalHash: crypto.randomUUID(),
          originalText: "No metadata",
          translatedText: "None",
          langFrom: "de",
          langTo: "en",
          source: "MOCK",
        },
      });
      for (const [projectId, langTo] of [
        [project.id, "fr"],
        [foreign.id, "en"],
      ]) {
        await db.translation.create({
          data: {
            projectId,
            langTo,
            originalHash: crypto.randomUUID(),
            originalText: "{name}",
            translatedText: "Missing",
            langFrom: "de",
            source: "MOCK",
            metadata: { create: { variables: ["{name}"], labels: ["qa"] } },
          },
        });
      }
      for (const quality of ["match", "mismatch", "unchecked"] as const) {
        const expected = rows
          .filter((_, i) => savedVariableQuality(...cases[i]) === quality)
          .map((r) => r.id);
        if (quality === "unchecked") expected.push(noMetadata.id);
        const result = await listProjectTranslationWorkflow({
          projectId: project.id,
          actor,
          filters: { quality, pageSize: 100 },
        });
        assert.deepEqual(result.items.map((r) => r.id).sort(), expected.sort());
        assert.equal(result.total, expected.length);
      }
      const matching = await listProjectTranslationWorkflow({
        projectId: project.id,
        actor,
        filters: {
          quality: "mismatch",
          label: " QA ",
          variables: "saved",
          source: "MOCK",
          mode: "automatic",
          status: "MACHINE",
          assignedToId: null,
          pageSize: 2,
          page: 2,
          sort: "created_asc",
        },
      });
      assert.equal(matching.total, 9);
      assert.deepEqual(
        matching.items.map((r) => r.id),
        rows.slice(2, 4).map((r) => r.id),
      );
      assert.equal(matching.totalPages, 5);
      assert.equal(
        (
          await listProjectTranslationWorkflow({
            projectId: project.id,
            actor,
            filters: { quality: "match", variables: "none" },
          })
        ).total,
        0,
      );
      assert.equal(
        (
          await listProjectTranslationWorkflow({
            projectId: project.id,
            actor,
            filters: { query: "%_\\'", quality: "unchecked" },
          })
        ).total,
        1,
      );
      assert.equal(
        (
          await listProjectTranslationWorkflow({
            projectId: project.id,
            actor,
            filters: { query: "' OR TRUE --" },
          })
        ).total,
        0,
      );
      await assert.rejects(
        listProjectTranslationWorkflow({
          projectId: project.id,
          actor,
          filters: { langTo: "fr", quality: "mismatch" },
        }),
        /not authorized/,
      );

      const cutoff = observationCutoff(new Date());
      await db.translationContext.createMany({
        data: [
          {
            translationId: rows[0].id,
            urlPath: "/old",
            lastSeenAt: new Date(cutoff.getTime() - 86_400_000),
          },
          {
            translationId: rows[1].id,
            urlPath: "/old",
            lastSeenAt: new Date(cutoff.getTime() - 86_400_000),
          },
          {
            translationId: rows[1].id,
            urlPath: "/new",
            lastSeenAt: new Date(),
          },
        ],
      });
      const older = await listProjectTranslationWorkflow({
        projectId: project.id,
        actor,
        filters: { activity: "older", quality: "mismatch" },
      });
      assert.deepEqual(
        older.items.map((r) => r.id),
        [rows[0].id],
      );
      const recent = await listProjectTranslationWorkflow({
        projectId: project.id,
        actor,
        filters: { activity: "recent", urlPath: "/old" },
      });
      assert.deepEqual(
        recent.items.map((r) => r.id),
        [rows[1].id],
        "activity is segment-wide, even when selecting an old path",
      );
      assert.equal(
        (
          await listProjectTranslationWorkflow({
            projectId: project.id,
            actor,
            filters: { activity: "unknown" },
          })
        ).total,
        rows.length - 2 + 1,
      );
      // Exact boundary, without relying on wall-clock timing during a request.
      await db.translationContext.updateMany({
        where: { translationId: rows[0].id },
        data: { lastSeenAt: cutoff },
      });
      const atBoundary = await db.$queryRaw<Array<{ id: string }>>(Prisma.sql`
      SELECT t.id FROM "Translation" t WHERE ${workspaceSqlWhere(project.id, "en", { activity: "recent" }, cutoff)}
    `);
      assert.ok(atBoundary.some((r) => r.id === rows[0].id));
      // Content edits immediately change quality without a stale derived table.
      await db.translation.update({
        where: { id: rows[0].id },
        data: { translatedText: "Hello {name}" },
      });
      assert.equal(
        (
          await listProjectTranslationWorkflow({
            projectId: project.id,
            actor,
            filters: { quality: "mismatch" },
          })
        ).total,
        8,
      );
    } finally {
      await db.organization.delete({ where: { id: org.id } });
      await db.$disconnect();
    }
  },
);
