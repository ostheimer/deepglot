import assert from "node:assert/strict";
import { test } from "node:test";
import { resolveDatabaseUrl } from "@/lib/database-url";
import { updateProjectTranslationMetadata } from "@/lib/translation-metadata-workflow";
import {
  listProjectTranslationWorkflow,
  TranslationWorkflowError,
} from "@/lib/translation-workflow";

test(
  "metadata is scoped, versioned, filterable and independent of translation content",
  { skip: !resolveDatabaseUrl() && "requires isolated PostgreSQL" },
  async () => {
    const { db } = await import("@/lib/db");
    const org = await db.organization.create({
      data: { name: "Metadata test", slug: crypto.randomUUID() },
    });
    try {
      const project = await db.project.create({
        data: {
          name: "Metadata",
          domain: "example.test",
          originalLang: "de",
          organizationId: org.id,
          languages: { create: [{ langCode: "en" }, { langCode: "fr" }] },
        },
      });
      const member = await db.projectMember.create({
        data: {
          projectId: project.id,
          email: "metadata@deepglot.local",
          role: "TRANSLATOR",
          langCode: "en",
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
      const segment = await db.translation.create({
        data: {
          projectId: project.id,
          originalHash: crypto.randomUUID(),
          originalText: "Hallo {{name}}",
          translatedText: "Hello {{name}}",
          langFrom: "de",
          langTo: "en",
          source: "MOCK",
          assignedToId: member.id,
          workflowStatus: "APPROVED",
        },
      });
      const plain = await db.translation.create({
        data: {
          projectId: project.id,
          originalHash: crypto.randomUUID(),
          originalText: "Ohne",
          translatedText: "Without",
          langFrom: "de",
          langTo: "en",
          source: "MOCK",
        },
      });
      const fr = await db.translation.create({
        data: {
          projectId: project.id,
          originalHash: crypto.randomUUID(),
          originalText: "Bonjour",
          translatedText: "Bonjour",
          langFrom: "de",
          langTo: "fr",
          source: "MOCK",
        },
      });
      const actor = {
        canManage: false,
        projectMemberId: member.id,
        langCode: "en",
      };
      const manager = {
        canManage: true,
        projectMemberId: null,
        langCode: null,
      };
      const metadata = {
        labels: ["Prüfen", " QA "],
        variables: ["{{name}}"],
        note: "Interne Notiz",
      };
      const input = {
        projectId: project.id,
        translationId: segment.id,
        actor,
        metadata,
        expectedVersion: 0,
      };
      const rejected = (code: string) => (error: unknown) =>
        error instanceof TranslationWorkflowError && error.code === code;
      await assert.rejects(
        updateProjectTranslationMetadata({ ...input, projectId: foreign.id }),
        rejected("NOT_FOUND"),
      );
      await assert.rejects(
        updateProjectTranslationMetadata({ ...input, translationId: fr.id }),
        rejected("FORBIDDEN"),
      );
      await assert.rejects(
        updateProjectTranslationMetadata({ ...input, translationId: plain.id }),
        rejected("FORBIDDEN"),
      );
      await assert.rejects(
        updateProjectTranslationMetadata({
          ...input,
          metadata: { ...metadata, variables: ["{{other}}"] },
        }),
        rejected("INVALID_PAYLOAD"),
      );
      const saved = await updateProjectTranslationMetadata(input);
      assert.equal(saved.version, 1);
      const unchanged = await db.translation.findUniqueOrThrow({
        where: { id: segment.id },
      });
      assert.equal(
        unchanged.updatedAt.toISOString(),
        segment.updatedAt.toISOString(),
      );
      assert.equal(unchanged.workflowStatus, "APPROVED");
      assert.equal(unchanged.translatedText, segment.translatedText);
      const matching = await listProjectTranslationWorkflow({
        projectId: project.id,
        actor,
        filters: {
          label: " QA ",
          variables: "saved",
          source: "MOCK",
          pageSize: 1,
        },
      });
      assert.equal(matching.total, 1);
      assert.equal(matching.items[0].id, segment.id);
      assert.equal(matching.items[0].metadata?.note, metadata.note);
      const missing = await listProjectTranslationWorkflow({
        projectId: project.id,
        actor,
        filters: { variables: "none" },
      });
      assert.deepEqual(
        missing.items.map((t) => t.id),
        [plain.id],
      );
      const concurrent = await Promise.allSettled([
        updateProjectTranslationMetadata({
          ...input,
          expectedVersion: 1,
          metadata: { ...metadata, note: "first" },
        }),
        updateProjectTranslationMetadata({
          ...input,
          expectedVersion: 1,
          metadata: { ...metadata, note: "second" },
        }),
      ]);
      assert.equal(
        concurrent.filter((result) => result.status === "fulfilled").length,
        1,
      );
      assert.ok(
        concurrent.some(
          (result) =>
            result.status === "rejected" &&
            rejected("STALE_UPDATE")(result.reason),
        ),
      );
      await updateProjectTranslationMetadata({
        ...input,
        actor: manager,
        expectedVersion: 2,
        metadata: { labels: [], variables: [], note: "" },
      });
      assert.equal(
        (
          await listProjectTranslationWorkflow({
            projectId: project.id,
            actor,
            filters: { variables: "none" },
          })
        ).total,
        2,
      );
      await db.projectLanguage.updateMany({
        where: { projectId: project.id, langCode: "en" },
        data: { isActive: false },
      });
      await assert.rejects(
        updateProjectTranslationMetadata({
          ...input,
          actor: manager,
          expectedVersion: 3,
        }),
        rejected("INVALID_LANGUAGE"),
      );
      await db.translation.delete({ where: { id: segment.id } });
      assert.equal(
        await db.translationMetadata.count({
          where: { translationId: segment.id },
        }),
        0,
      );
    } finally {
      await db.organization.delete({ where: { id: org.id } });
      await db.$disconnect();
    }
  },
);
