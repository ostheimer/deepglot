import assert from "node:assert/strict";
import { test } from "node:test";
import { resolveDatabaseUrl } from "@/lib/database-url";
import { recordTranslationContexts } from "@/lib/translation-context";
import { listProjectTranslationWorkflow } from "@/lib/translation-workflow";

test(
  "page associations, advanced filters and navigation remain tenant/language scoped",
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
          name: "Context",
          domain: "example.test",
          originalLang: "de",
          organizationId: org.id,
          languages: { create: [{ langCode: "en" }, { langCode: "fr" }] },
        },
      });
      const foreign = await db.project.create({
        data: {
          name: "Other",
          domain: "other.test",
          originalLang: "de",
          organizationId: org.id,
        },
      });
      const create = (
        projectId: string,
        langTo: string,
        originalHash: string,
        isManual = false,
      ) =>
        db.translation.create({
          data: {
            projectId,
            langFrom: "de",
            langTo,
            originalHash,
            originalText: originalHash,
            translatedText: "Translated",
            isManual,
            source: isManual ? "MANUAL" : "MOCK",
          },
        });
      const en = await create(project.id, "en", "same-hash", true);
      const fr = await create(project.id, "fr", "french");
      const unknown = await create(project.id, "en", "unknown");
      await create(foreign.id, "en", "same-hash");
      const record = (langTo: string, hashes: string[], path: string) =>
        db.$transaction((tx) =>
          recordTranslationContexts(tx, {
            projectId: project.id,
            domain: project.domain,
            requestUrl: `https://example.test${path}`,
            langFrom: "de",
            langTo,
            hashes,
          }),
        );
      await record(
        "en",
        ["same-hash", "same-hash"],
        "/prices?secret=1#private",
      );
      await record("en", ["same-hash"], "/prices");
      await record("en", ["same-hash"], "/about");
      await record("fr", ["french"], "/french-only");
      assert.equal(
        await db.translationContext.count({
          where: { translation: { projectId: project.id } },
        }),
        3,
      );
      assert.equal(
        await db.translationContext.count({
          where: { translation: { projectId: foreign.id } },
        }),
        0,
      );
      const actor = {
        canManage: false,
        projectMemberId: "translator",
        langCode: "en",
      };
      const all = await listProjectTranslationWorkflow({
        projectId: project.id,
        actor,
      });
      assert.deepEqual(
        all.contextPaths.map((row) => row.urlPath),
        ["/about", "/prices"],
      );
      assert.equal(all.total, 2);
      const filtered = await listProjectTranslationWorkflow({
        projectId: project.id,
        actor,
        filters: {
          urlPath: "/prices",
          source: "MANUAL",
          mode: "manual",
          context: "known",
          query: "same",
          pageSize: 1,
          sort: "original_asc",
        },
      });
      assert.deepEqual(
        filtered.items.map((row) => row.id),
        [en.id],
      );
      assert.equal(filtered.total, 1);
      assert.equal(filtered.items[0].contexts.length, 2);
      assert.equal(
        filtered.items[0].updatedAt.toISOString(),
        en.updatedAt.toISOString(),
        "observations must not invalidate editing concurrency tokens",
      );
      const missing = await listProjectTranslationWorkflow({
        projectId: project.id,
        actor,
        filters: { context: "unknown", mode: "automatic" },
      });
      assert.deepEqual(
        missing.items.map((row) => row.id),
        [unknown.id],
      );
      const hidden = await listProjectTranslationWorkflow({
        projectId: project.id,
        actor,
        filters: { urlPath: "/french-only" },
      });
      assert.equal(hidden.total, 0);
      await assert.rejects(
        listProjectTranslationWorkflow({
          projectId: project.id,
          actor,
          filters: { langTo: "fr" },
        }),
      );
      const contradictory = await listProjectTranslationWorkflow({
        projectId: project.id,
        actor,
        filters: { context: "unknown", urlPath: "/prices" },
      });
      assert.equal(
        contradictory.total,
        0,
        "combined filters must not silently override each other",
      );
      await db.translationContext.createMany({
        data: Array.from({ length: 105 }, (_, index) => ({
          translationId: en.id,
          urlPath: `/bounded-${index}`,
        })),
      });
      const bounded = await listProjectTranslationWorkflow({
        projectId: project.id,
        actor,
        filters: { urlPath: "/prices" },
      });
      assert.equal(bounded.items[0].contexts.length, 100);
      assert.equal(bounded.items[0]._count.contexts, 107);
      await db.translation.delete({ where: { id: en.id } });
      assert.equal(
        await db.translationContext.count({ where: { translationId: en.id } }),
        0,
      );
      assert.equal(
        await db.translationContext.count({ where: { translationId: fr.id } }),
        1,
      );
    } finally {
      await db.organization.delete({ where: { id: org.id } });
      await db.$disconnect();
    }
  },
);
